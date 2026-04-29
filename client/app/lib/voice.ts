import { Device } from 'mediasoup-client';
import type { types } from 'mediasoup-client';
// Audio-processing libs each define `class X extends AudioWorkletNode` at
// module top level. Importing them statically would crash SSR (Node has no
// AudioWorkletNode). Type-only imports keep the type info without emitting
// a runtime require; the value-level references are loaded lazily in the
// methods below via `await import(...)`.
import type { RnnoiseWorkletNode as RnnoiseWorkletNodeType } from '@sapphi-red/web-noise-suppressor';
import type { MicVAD as MicVADType } from '@ricky0123/vad-web';

const EQ_FREQS = [80, 250, 1000, 4000, 10000];
const EQ_TYPES: BiquadFilterType[] = ['lowshelf', 'peaking', 'peaking', 'peaking', 'highshelf'];

// Asset paths served by vite-plugin-static-copy from /audio. The worklet
// modules and WASM binaries need to be reachable at runtime under these URLs.
const AUDIO_ASSETS = {
  rnnoiseWorklet: '/audio/rnnoise-worklet.js',
  rnnoiseWasm: '/audio/rnnoise.wasm',
  rnnoiseSimdWasm: '/audio/rnnoise_simd.wasm',
  vadBase: '/audio/',
  ortBase: '/audio/',
};

export type ScreenShareSettings = {
  resolution: 720 | 1080 | 1440;
  frameRate: 30 | 60;
};

// Bitrate targets by resolution and frame rate (matches Discord Nitro-tier quality)
export const SCREEN_BITRATES: Record<string, number> = {
  '720-30':  2_500_000,
  '720-60':  4_000_000,
  '1080-30': 4_000_000,
  '1080-60': 8_000_000,
  '1440-30': 6_000_000,
  '1440-60': 12_000_000,
};

// Resolution height -> width (16:9 aspect ratio)
const RESOLUTION_WIDTH: Record<number, number> = {
  720: 1280,
  1080: 1920,
  1440: 2560,
};

// Send a voice request over WebSocket and await the matching response.
// cleanup() runs on timeout, matched response, or send failure — without it,
// a ws.send() throw (socket closed between readyState check and send) would
// leak the handler and timer.
function request(ws: WebSocket, action: string, data: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket is not open'));
      return;
    }
    const requestId = crypto.randomUUID();
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ws.removeEventListener('message', handler);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Request "${action}" timed out`));
    }, 10000);
    const handler = (event: MessageEvent) => {
      const msg = JSON.parse(event.data);
      if (msg.requestId === requestId) {
        cleanup();
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg);
      }
    };
    ws.addEventListener('message', handler);
    try {
      ws.send(JSON.stringify({ requestId, type: 'voice', action, ...data }));
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

type VoiceHandlers = {
  onPeerJoined: (channelId: string, username: string) => void;
  onPeerLeft: (channelId: string, username: string) => void;
  onLevelChange: (username: string, level: number) => void;
  onVideoTrack: (username: string, track: MediaStreamTrack | null) => void;
  onScreenTrack: (username: string, track: MediaStreamTrack | null) => void;
  onScreenAudioChange: (username: string, available: boolean) => void;
  onSessionSuperseded?: () => void;
};

export class VoiceClient {
  private device: Device | null = null;
  private sendTransport: types.Transport | null = null;
  private recvTransport: types.Transport | null = null;
  private audioProducer: types.Producer | null = null;
  private videoProducer: types.Producer | null = null;
  private videoStream: MediaStream | null = null;
  private screenProducer: types.Producer | null = null;
  private screenAudioProducer: types.Producer | null = null;
  private screenStream: MediaStream | null = null;
  private consumers = new Map<string, types.Consumer>();
  private screenAudioElements = new Map<string, HTMLAudioElement>(); // username -> audio element
  // producerId -> kind. 'mic' is the default for audio producers with no source tag.
  private producerSources = new Map<string, 'mic' | 'camera' | 'screen' | 'screen-audio'>();
  private ws: WebSocket;
  private channelId: string | null = null;
  private handlers: VoiceHandlers;
  private notificationHandler: (event: MessageEvent) => void;
  private localUsername: string | null = null;

  // Audio level monitoring
  private audioContext: AudioContext | null = null;
  private analysers = new Map<string, AnalyserNode>(); // username -> analyser
  private userLevels = new Map<string, number>(); // username -> smoothed level 0..1
  private producerUsernames = new Map<string, string>(); // producerId -> username
  private levelCheckInterval: ReturnType<typeof setInterval> | null = null;

  // Master gain / VAD / PTT — set from the Voice settings tab, persisted to
  // localStorage, applied transparently to the outgoing mic track.
  private micGainNode: GainNode | null = null;
  private vadGateNode: GainNode | null = null;
  private micDestination: MediaStreamAudioDestinationNode | null = null;
  private rawMicStream: MediaStream | null = null;
  private micGain = 1;
  private speakerGain = 1;
  // VAD modes: off = always open, auto = Silero-driven. "Manual threshold"
  // was dropped once Silero landed — it was never better than a hand-tuned
  // auto gate. PTT layers on top of either.
  private vadMode: 'off' | 'auto' = 'off';
  private pttEnabled = false;
  private pttKey = '';
  private pttHeld = false;
  // Silero-driven speaking state for the local mic. `true` while Silero
  // considers the user to be speaking (between onSpeechStart / onSpeechEnd).
  private silenceDetected = true;
  private micVAD: MicVADType | null = null;
  private micVADPromise: Promise<void> | null = null;
  private userBaseVolumes = new Map<string, number>(); // username -> 0..2 (pre-speakerGain)
  private userMutedState = new Map<string, boolean>(); // username -> muted
  private userGainNodes = new Map<string, GainNode>(); // username -> receive gain
  private trackPumpers = new Map<string, HTMLAudioElement>(); // muted <audio> per user that keeps WebRTC tracks flowing into Web Audio
  // RNNoise state. Lazy-loaded on first mic graph build; cached thereafter.
  private rnnoiseEnabled = true;
  private rnnoiseNode: RnnoiseWorkletNodeType | null = null;
  private rnnoiseWasmBinary: ArrayBuffer | null = null;
  private rnnoiseWorkletPromise: Promise<void> | null = null;
  private masterGainNode: GainNode | null = null;
  private eqEnabled = false;
  private eqBands: { gain: number; q: number }[] = EQ_FREQS.map(() => ({ gain: 0, q: 1 }));
  private eqNodes: BiquadFilterNode[] = [];
  private keyDownHandler: (e: KeyboardEvent) => void;
  private keyUpHandler: (e: KeyboardEvent) => void;
  private joinInProgress = false;

  constructor(ws: WebSocket, handlers: VoiceHandlers) {
    this.ws = ws;
    this.handlers = handlers;

    // Load persisted voice settings
    this.micGain = parseFloat(localStorage.getItem('micGain') ?? '1');
    this.speakerGain = parseFloat(localStorage.getItem('speakerGain') ?? '1');
    const storedMode = localStorage.getItem('vadMode');
    // Migrate the removed 'manual' mode to 'auto' (Silero supersedes it).
    if (storedMode === 'off' || storedMode === 'auto') this.vadMode = storedMode;
    else if (storedMode === 'manual') this.vadMode = 'auto';
    this.pttEnabled = localStorage.getItem('pttEnabled') === 'true';
    this.pttKey = localStorage.getItem('pttKey') ?? '';
    const storedRnnoise = localStorage.getItem('rnnoiseEnabled');
    this.rnnoiseEnabled = storedRnnoise === null ? true : storedRnnoise === 'true';
    this.eqEnabled = localStorage.getItem('micEqEnabled') === 'true';
    const storedBands = localStorage.getItem('micEqBands');
    if (storedBands) {
      try {
        const parsed = JSON.parse(storedBands);
        if (Array.isArray(parsed) && parsed.length === 5) {
          this.eqBands = parsed.map((b: any) => ({
            gain: typeof b?.gain === 'number' ? b.gain : 0,
            q: typeof b?.q === 'number' ? b.q : 1,
          }));
        }
      } catch {}
    }

    // PTT listeners — always installed, gated on pttEnabled so toggling
    // from the settings tab takes effect without rewiring event handlers.
    this.keyDownHandler = (e: KeyboardEvent) => {
      if (!this.pttEnabled || !this.pttKey || e.key !== this.pttKey) return;
      this.pttHeld = true;
      this.updateVadGate();
    };
    this.keyUpHandler = (e: KeyboardEvent) => {
      if (!this.pttEnabled || !this.pttKey || e.key !== this.pttKey) return;
      this.pttHeld = false;
      this.updateVadGate();
    };
    window.addEventListener('keydown', this.keyDownHandler);
    window.addEventListener('keyup', this.keyUpHandler);

    // Listen for voice notifications
    this.notificationHandler = (event: MessageEvent) => {
      const msg = JSON.parse(event.data);
      if (msg.type !== 'voice-notification') return;

      switch (msg.action) {
        case 'new-producer':
          if (msg.username) this.producerUsernames.set(msg.producerId, msg.username);
          if (msg.source) this.producerSources.set(msg.producerId, msg.source);
          this.consumeProducer(msg.producerId);
          break;
        case 'producer-closed':
          this.removeProducer(msg.producerId);
          break;
        case 'peer-joined':
          this.handlers.onPeerJoined(msg.channelId, msg.username);
          new Audio('/sounds/join.mp3').play().catch(() => {});
          break;
        case 'peer-left':
          this.handlers.onPeerLeft(msg.channelId, msg.username);
          new Audio('/sounds/leave.mp3').play().catch(() => {});
          break;
        case 'session-superseded':
          this.handlers.onSessionSuperseded?.();
          break;
      }
    };
    ws.addEventListener('message', this.notificationHandler);
  }

  async join(channelId: string, username?: string) {
    // Rapid channel switches / double-clicks would otherwise spawn a second
    // Device + AudioContext and race the two transport setups against each
    // other. Guard at the top and release in finally.
    if (this.joinInProgress) throw new Error('Join already in progress');
    this.joinInProgress = true;
    try {
      this.channelId = channelId;
      if (username) this.localUsername = username;
      this.device = new Device();
      // Pin to 48 kHz so the whole graph (WebRTC Opus, mic source, worklets)
      // runs at one rate. Some hardware (older macOS USB devices) rejects
      // the exact-rate constructor — fall back to the OS default in that
      // case. RNNoise assumes 48 kHz input; if the fallback context isn't
      // at 48 kHz we'll skip instantiating RNNoise in buildMicGraph.
      try {
        this.audioContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      } catch {
        this.audioContext = new AudioContext({ latencyHint: 'interactive' });
      }
      // Browsers may start AudioContext in suspended state — resume it
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Shared receive graph: every remote mic feeds one GainNode per user
      // (driven by the dB volume slider), summing into masterGain and out
      // to the destination. Avoiding an <audio> element here is deliberate:
      // Chrome's tab-audio capture (getDisplayMedia with audio: true)
      // includes DOM-attached media elements before setSinkId routing, so
      // an <audio> sink would leak the received voice into screen-share.
      this.masterGainNode = this.audioContext.createGain();
      this.masterGainNode.gain.value = 1; // deafen sets to 0
      this.masterGainNode.connect(this.audioContext.destination);

      // Route the AudioContext itself to the user's chosen output device.
      // Chrome 110+ / Electron 35 supports AudioContext.setSinkId; older
      // runtimes fall back to the default device.
      const outputDevice = localStorage.getItem("preferredOutputDevice");
      if (outputDevice && 'setSinkId' in this.audioContext) {
        (this.audioContext as any).setSinkId(outputDevice).catch(() => {});
      }

      // Get router capabilities and join the room
      const joinResult = await request(this.ws, 'join', { channelId });
      await this.device.load({ routerRtpCapabilities: joinResult.rtpCapabilities });

      // Create send transport
      const sendParams = await request(this.ws, 'create-transport', { channelId, direction: 'send' });
      this.sendTransport = this.device.createSendTransport({
        id: sendParams.id,
        iceParameters: sendParams.iceParameters,
        iceCandidates: sendParams.iceCandidates,
        dtlsParameters: sendParams.dtlsParameters,
      });

      this.sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        request(this.ws, 'connect-transport', {
          channelId, transportId: this.sendTransport!.id, dtlsParameters,
        }).then(() => callback()).catch(errback);
      });

      this.sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        request(this.ws, 'produce', {
          channelId, kind, rtpParameters, source: appData?.source,
        }).then(({ producerId }) => callback({ id: producerId })).catch(errback);
      });

      // Produce audio from microphone. The raw stream is routed through a
      // Web Audio graph (source → [RNNoise] → EQ → micGain → vadGate → dest)
      // so noise suppression, EQ, gain, and VAD can be applied before the
      // track reaches mediasoup.
      //
      // autoGainControl: false — Chromium's AGC silently lowers input gain
      //   mid-session on USB interfaces like the Wave XLR.
      // echoCancellation / noiseSuppression: false — setting either to true
      //   opens the mic in Windows' "Communications" audio category, which
      //   triggers the OS-level ducking rule that drops every other app's
      //   volume (Discord, Spotify, game audio) by up to 80%. We run
      //   RNNoise in userspace instead, which gives equivalent noise
      //   suppression without touching the OS audio category.
      const preferredAudio = localStorage.getItem("preferredAudioDevice");
      const micConstraints = {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
        channelCount: 1,
        sampleRate: 48000,
      };
      try {
        this.rawMicStream = await navigator.mediaDevices.getUserMedia({
          audio: { ...(preferredAudio && { deviceId: { exact: preferredAudio } }), ...micConstraints },
        });
      } catch (err) {
        // Stored device is gone or no longer matches — drop it and use default.
        if (preferredAudio) localStorage.removeItem("preferredAudioDevice");
        this.rawMicStream = await navigator.mediaDevices.getUserMedia({
          audio: micConstraints,
        });
      }
      // RNNoise WASM + worklet need to be ready before buildMicGraph can
      // insert the node. One-time ~250 KB fetch on first voice join; cached
      // thereafter. Time-box the load so a slow / stuck network can't hang
      // the whole voice-join path — on timeout buildMicGraph skips RNNoise
      // and the user still gets audio (just without noise suppression).
      await Promise.race([
        this.ensureRnnoise(),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
      const gatedTrack = await this.buildMicGraph(this.rawMicStream);
      // opusFec: in-band Forward Error Correction — recovers single lost packets
      //   without retransmit. Biggest audible win on lossy networks.
      // opusNack: NACK-based retransmission of lost audio packets.
      // opusStereo=false: explicit mono; stereo on a single mic is wasted bits.
      // opusMaxAverageBitrate=64000: Opus default negotiates ~32 kbps for mono;
      //   64 kbps is where voice stops sounding compressed (Discord-tier).
      // DTX intentionally omitted — its SID/active-frame transitions produce
      //   audible blips at speech onset on some Opus decoders.
      this.audioProducer = await this.sendTransport.produce({
        track: gatedTrack,
        codecOptions: {
          opusFec: true,
          opusNack: true,
          opusStereo: false,
          opusMaxAverageBitrate: 64000,
        },
      });

      // Monitor local mic audio levels on the raw (pre-gate) stream so the
      // level meter reflects actual input, not what's being transmitted.
      if (this.localUsername && this.audioContext) {
        const source = this.audioContext.createMediaStreamSource(this.rawMicStream);
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        this.analysers.set(this.localUsername, analyser);
      }

      // Create recv transport
      const recvParams = await request(this.ws, 'create-transport', { channelId, direction: 'recv' });
      this.recvTransport = this.device.createRecvTransport({
        id: recvParams.id,
        iceParameters: recvParams.iceParameters,
        iceCandidates: recvParams.iceCandidates,
        dtlsParameters: recvParams.dtlsParameters,
      });

      this.recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        request(this.ws, 'connect-transport', {
          channelId, transportId: this.recvTransport!.id, dtlsParameters,
        }).then(() => callback()).catch(errback);
      });

      // Consume existing producers in the channel
      for (const { producerId, username: producerUsername, source } of joinResult.existingProducers) {
        if (producerUsername) this.producerUsernames.set(producerId, producerUsername);
        if (source) this.producerSources.set(producerId, source);
        await this.consumeProducer(producerId);
      }

      // Start polling audio levels
      this.startLevelMonitoring();

      // Kick off Silero in the background if auto-VAD is selected. Fire and
      // forget — the model download shouldn't block the join from resolving.
      if (this.vadMode === 'auto') this.ensureMicVAD();
    } finally {
      this.joinInProgress = false;
    }
  }

  private async consumeProducer(producerId: string) {
    if (!this.channelId || !this.recvTransport || !this.device) return;

    const result = await request(this.ws, 'consume', {
      channelId: this.channelId,
      producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });

    const consumer = await this.recvTransport.consume({
      id: result.consumerId,
      producerId: result.producerId,
      kind: result.kind,
      rtpParameters: result.rtpParameters,
    });

    this.consumers.set(producerId, consumer);
    const remoteUsername = this.producerUsernames.get(producerId);
    // Default audio = mic, default video = camera.
    let source = this.producerSources.get(producerId);
    if (!source) {
      source = consumer.kind === 'video' ? 'camera' : 'mic';
      this.producerSources.set(producerId, source);
    }

    if (consumer.kind === 'video') {
      if (remoteUsername) {
        if (source === 'screen') this.handlers.onScreenTrack(remoteUsername, consumer.track);
        else this.handlers.onVideoTrack(remoteUsername, consumer.track);
      }
      return;
    }

    // Screen share audio — track separately for per-user volume control
    if (source === 'screen-audio' && remoteUsername) {
      const audio = this.createAudioElement();
      audio.srcObject = new MediaStream([consumer.track]);
      audio.play().catch(() => {});
      this.screenAudioElements.set(remoteUsername, audio);
      this.handlers.onScreenAudioChange(remoteUsername, true);
      return;
    }

    // Route received mic audio through the per-peer graph. One source feeds
    // the per-user GainNode and an analyser (for the speaking indicator).
    if (remoteUsername && this.audioContext && this.masterGainNode) {
      // Chromium won't deliver audio from a WebRTC-sourced track into
      // createMediaStreamSource unless an <audio> element is actively
      // playing that track. Create a muted, DOM-attached pump per peer.
      const pumper = new Audio();
      pumper.srcObject = new MediaStream([consumer.track]);
      pumper.muted = true;
      pumper.style.display = 'none';
      document.body.appendChild(pumper);
      pumper.play().catch(() => {});
      this.trackPumpers.set(remoteUsername, pumper);

      const trackSource = this.audioContext.createMediaStreamSource(new MediaStream([consumer.track]));
      const gainNode = this.audioContext.createGain();
      trackSource.connect(gainNode);
      this.userGainNodes.set(remoteUsername, gainNode);
      gainNode.connect(this.masterGainNode);
      this.applyUserGain(remoteUsername);

      // Analyser tap for the speaking indicator, post per-peer gain so
      // boosting a quiet peer also boosts their indicator intensity.
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      gainNode.connect(analyser);
      this.analysers.set(remoteUsername, analyser);
    }
  }

  private applyUserGain(username: string) {
    const node = this.userGainNodes.get(username);
    if (!node || !this.audioContext) return;
    const muted = this.userMutedState.get(username) ?? false;
    const base = this.userBaseVolumes.get(username) ?? 1;
    const target = muted ? 0 : base * this.speakerGain;
    // Smooth ramp keeps manual volume-slider drags glitch-free.
    try {
      node.gain.cancelScheduledValues(this.audioContext.currentTime);
      node.gain.setTargetAtTime(target, this.audioContext.currentTime, 0.05);
    } catch {
      node.gain.value = target;
    }
  }

  private removeProducer(producerId: string) {
    const consumer = this.consumers.get(producerId);
    if (consumer) {
      consumer.close();
      this.consumers.delete(producerId);
    }

    const username = this.producerUsernames.get(producerId);
    const source = this.producerSources.get(producerId);

    if (source === 'screen-audio') {
      if (username) {
        const audio = this.screenAudioElements.get(username);
        if (audio) { audio.srcObject = null; this.screenAudioElements.delete(username); }
        this.handlers.onScreenAudioChange(username, false);
      }
    } else if (source === 'screen') {
      if (username) this.handlers.onScreenTrack(username, null);
    } else if (source === 'camera') {
      if (username) this.handlers.onVideoTrack(username, null);
    } else if (username) {
      // Mic audio (source === 'mic' or legacy undefined)
      const gainNode = this.userGainNodes.get(username);
      if (gainNode) {
        gainNode.disconnect();
        this.userGainNodes.delete(username);
      }
      const pumper = this.trackPumpers.get(username);
      if (pumper) {
        pumper.srcObject = null;
        pumper.remove();
        this.trackPumpers.delete(username);
      }
      this.userBaseVolumes.delete(username);
      this.userMutedState.delete(username);
      this.analysers.delete(username);
      this.userLevels.delete(username);
      this.handlers.onLevelChange(username, 0);
    }

    if (username) this.producerUsernames.delete(producerId);
    this.producerSources.delete(producerId);
  }

  // Load RNNoise WASM + worklet module once per AudioContext, cache the
  // promise so repeated mic rebuilds don't re-fetch. Safe to call when
  // RNNoise is toggled off — we still pay the load cost once so toggling
  // on mid-call doesn't block.
  private ensureRnnoise(): Promise<void> {
    if (this.rnnoiseWorkletPromise) return this.rnnoiseWorkletPromise;
    const ctx = this.audioContext;
    if (!ctx) return Promise.reject(new Error('AudioContext not initialized'));
    this.rnnoiseWorkletPromise = (async () => {
      try {
        // Dynamic import — the package's entry pulls in a class that
        // subclasses AudioWorkletNode, so it can't be evaluated under SSR.
        const { loadRnnoise } = await import('@sapphi-red/web-noise-suppressor');
        const [wasm] = await Promise.all([
          loadRnnoise({ url: AUDIO_ASSETS.rnnoiseWasm, simdUrl: AUDIO_ASSETS.rnnoiseSimdWasm }),
          ctx.audioWorklet.addModule(AUDIO_ASSETS.rnnoiseWorklet),
        ]);
        this.rnnoiseWasmBinary = wasm;
      } catch {
        // Non-fatal: mic graph falls back to the non-RNNoise path.
        this.rnnoiseWasmBinary = null;
      }
    })();
    return this.rnnoiseWorkletPromise;
  }

  private async buildMicGraph(stream: MediaStream): Promise<MediaStreamTrack> {
    if (!this.audioContext) throw new Error('AudioContext not initialized');
    this.micGainNode?.disconnect();
    this.vadGateNode?.disconnect();
    this.micDestination?.disconnect();
    this.rnnoiseNode?.disconnect();
    try { (this.rnnoiseNode as any)?.destroy?.(); } catch {}
    this.rnnoiseNode = null;
    this.eqNodes.forEach((n) => n.disconnect());
    this.eqNodes = [];

    const source = this.audioContext.createMediaStreamSource(stream);
    this.micGainNode = this.audioContext.createGain();
    this.micGainNode.gain.value = this.micGain;
    this.vadGateNode = this.audioContext.createGain();
    // Start open; Silero callbacks and PTT listeners will close it as needed.
    this.vadGateNode.gain.value = 1;
    this.micDestination = this.audioContext.createMediaStreamDestination();

    // Instantiate RNNoise if enabled, the WASM + worklet loaded, and the
    // AudioContext is running at RNNoise's required 48 kHz. A fallback
    // context (see join()) at a different rate would produce pitch-shifted
    // output — skip RNNoise in that case rather than ship garbage.
    if (
      this.rnnoiseEnabled &&
      this.rnnoiseWasmBinary &&
      this.audioContext.sampleRate === 48000
    ) {
      try {
        const { RnnoiseWorkletNode } = await import('@sapphi-red/web-noise-suppressor');
        this.rnnoiseNode = new RnnoiseWorkletNode(this.audioContext, {
          wasmBinary: this.rnnoiseWasmBinary,
          maxChannels: 1,
        });
      } catch {
        this.rnnoiseNode = null;
      }
    }

    // Build the EQ chain unconditionally — keeps wiring stable across
    // enable/disable. When disabled, band gains are zeroed so biquads are
    // transparent in magnitude (minor phase shift is inaudible).
    for (let i = 0; i < EQ_FREQS.length; i++) {
      const filter = this.audioContext.createBiquadFilter();
      filter.type = EQ_TYPES[i];
      filter.frequency.value = EQ_FREQS[i];
      filter.Q.value = this.eqBands[i].q;
      filter.gain.value = this.eqEnabled ? this.eqBands[i].gain : 0;
      this.eqNodes.push(filter);
    }

    let prev: AudioNode = source;
    if (this.rnnoiseNode) {
      prev.connect(this.rnnoiseNode);
      prev = this.rnnoiseNode;
    }
    for (const filter of this.eqNodes) {
      prev.connect(filter);
      prev = filter;
    }
    prev.connect(this.micGainNode);
    this.micGainNode.connect(this.vadGateNode);
    this.vadGateNode.connect(this.micDestination);

    return this.micDestination.stream.getAudioTracks()[0];
  }

  // Initialize Silero-based auto-VAD. Keeps a single MicVAD instance; the
  // library opens its own tap on rawMicStream and reports speech-start/end
  // via callbacks. onSpeech* drive this.silenceDetected; updateVadGate()
  // turns that into the actual vadGate gain value.
  private async ensureMicVAD() {
    if (this.micVAD || this.micVADPromise) return this.micVADPromise ?? undefined;
    const stream = this.rawMicStream;
    if (!stream) return;
    this.micVADPromise = (async () => {
      try {
        const { MicVAD } = await import('@ricky0123/vad-web');
        this.micVAD = await MicVAD.new({
          // Feed Silero our existing mic stream instead of letting it open
          // its own getUserMedia — we want exactly one mic instance.
          getStream: async () => stream,
          pauseStream: async () => {},
          resumeStream: async (s) => s,
          startOnLoad: true,
          model: 'v5',
          baseAssetPath: AUDIO_ASSETS.vadBase,
          onnxWASMBasePath: AUDIO_ASSETS.ortBase,
          onSpeechStart: () => {
            this.silenceDetected = false;
            this.updateVadGate();
          },
          onSpeechEnd: () => {
            this.silenceDetected = true;
            this.updateVadGate();
          },
          onVADMisfire: () => {
            this.silenceDetected = true;
            this.updateVadGate();
          },
        });
      } catch {
        // Silero failed to load — fall back to always-open gate in auto mode.
        this.micVAD = null;
        this.silenceDetected = false;
        this.updateVadGate();
      }
    })();
    return this.micVADPromise;
  }

  private updateVadGate() {
    if (!this.vadGateNode) return;
    let open: boolean;
    if (this.pttEnabled) {
      open = this.pttHeld;
    } else if (this.vadMode === 'off') {
      open = true;
    } else {
      // Silero drives the gate in auto mode. While the model is still
      // loading, silenceDetected defaults to true → gate closed. Once
      // loaded, onSpeechStart / onSpeechEnd flip it within ~100 ms.
      open = !this.silenceDetected;
    }
    // Short ramp avoids audible clicks on gate toggle. Web Audio ignores
    // setTargetAtTime timing on a disconnected node, so wrap in a try.
    try {
      const param = this.vadGateNode.gain;
      const ctx = this.audioContext;
      if (ctx) {
        param.cancelScheduledValues(ctx.currentTime);
        param.setTargetAtTime(open ? 1 : 0, ctx.currentTime, 0.015);
      } else {
        param.value = open ? 1 : 0;
      }
    } catch {
      this.vadGateNode.gain.value = open ? 1 : 0;
    }
  }

  private startLevelMonitoring() {
    // RMS level → 0..1 display level. Floor subtracts room-noise baseline so
    // silence sits at true 0; sqrt curve expands the low/mid range so quiet
    // speech still produces a visible indicator rather than a barely-lit pip.
    const RMS_FLOOR = 1.0;
    const RMS_TARGET = 30;
    const bufferLength = 256; // matches fftSize on our analysers
    const dataArray = new Uint8Array(bufferLength);

    this.levelCheckInterval = setInterval(() => {
      for (const [username, analyser] of this.analysers) {
        analyser.getByteTimeDomainData(dataArray);
        // RMS deviation from silence (128 = silence center in byte domain)
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const deviation = dataArray[i] - 128;
          sumSquares += deviation * deviation;
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);

        // Gate the indicator for the local user on whether we're actually
        // transmitting — PTT/VAD users shouldn't glow while peers hear silence.
        const isLocal = username === this.localUsername;
        const gateOpen = !isLocal || !this.vadGateNode || this.vadGateNode.gain.value > 0.001;
        const raw = Math.max(0, rms - RMS_FLOOR) / RMS_TARGET;
        const target = gateOpen ? Math.min(1, Math.sqrt(raw)) : 0;

        // Fast attack, slow release — natural VU-meter feel. Without release
        // smoothing the indicator would flash off between syllables.
        const prev = this.userLevels.get(username) ?? 0;
        const alpha = target > prev ? 0.8 : 0.25;
        const smoothed = prev * (1 - alpha) + target * alpha;
        this.userLevels.set(username, smoothed);

        if (Math.abs(smoothed - prev) > 0.02 || (smoothed < 0.02 && prev >= 0.02)) {
          this.handlers.onLevelChange(username, smoothed);
        }
      }
    }, 100);
  }

  private stopLevelMonitoring() {
    if (this.levelCheckInterval) {
      clearInterval(this.levelCheckInterval);
      this.levelCheckInterval = null;
    }
    // Notify all as silent
    for (const [username] of this.userLevels) {
      this.handlers.onLevelChange(username, 0);
    }
    this.analysers.clear();
    this.userLevels.clear();
    this.producerUsernames.clear();
    this.audioContext?.close();
    this.audioContext = null;
  }

  toggleMute(): boolean {
    if (!this.audioProducer) return false;
    if (this.audioProducer.paused) this.audioProducer.resume();
    else this.audioProducer.pause();
    return this.audioProducer.paused;
  }

  async startVideo() {
    if (!this.sendTransport || !this.channelId || this.videoProducer) return;
    const preferredVideo = localStorage.getItem("preferredVideoDevice");
    this.videoStream = await navigator.mediaDevices.getUserMedia({
      video: preferredVideo ? { deviceId: { exact: preferredVideo } } : true,
    });
    const videoTrack = this.videoStream.getVideoTracks()[0];
    this.videoProducer = await this.sendTransport.produce({ track: videoTrack, appData: { source: 'camera' } });

    // Show local video via handler
    if (this.localUsername) {
      this.handlers.onVideoTrack(this.localUsername, videoTrack);
    }
  }

  async stopVideo() {
    if (!this.videoProducer || !this.channelId) return;

    // Tell the server to close this producer and notify other peers
    const producerId = this.videoProducer.id;
    try {
      await request(this.ws, 'close-producer', { channelId: this.channelId, producerId });
    } catch {}

    this.videoProducer.close();
    this.videoProducer = null;

    // Stop the camera hardware
    this.videoStream?.getTracks().forEach((t) => t.stop());
    this.videoStream = null;

    // Notify React to remove local video
    if (this.localUsername) {
      this.handlers.onVideoTrack(this.localUsername, null);
    }
  }

  async startScreenShare(settings: ScreenShareSettings) {
    if (!this.sendTransport || !this.channelId || this.screenProducer) return;

    const width = RESOLUTION_WIDTH[settings.resolution];
    const height = settings.resolution;

    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: width, max: width },
        height: { ideal: height, max: height },
        frameRate: { ideal: settings.frameRate, max: settings.frameRate },
      },
      audio: true,
    });
    const screenTrack = this.screenStream.getVideoTracks()[0];

    // Prioritize framerate — with our bitrate headroom, motion mode stays sharp for text too.
    screenTrack.contentHint = 'motion';

    // Browser "Stop sharing" button closes the track — handle it
    screenTrack.onended = () => { this.stopScreenShare(); };

    const maxBitrate = SCREEN_BITRATES[`${settings.resolution}-${settings.frameRate}`];

    // Prefer H.264 — nearly every GPU has hardware H.264 encoding (NVENC, QuickSync, AMF),
    // which offloads encoding from the CPU. Critical when the user is gaming and sharing.
    const h264Codec = this.device?.rtpCapabilities.codecs?.find(
      (c) => c.mimeType.toLowerCase() === 'video/h264'
    );

    this.screenProducer = await this.sendTransport.produce({
      track: screenTrack,
      appData: { source: 'screen' },
      codec: h264Codec,
      encodings: [{
        maxBitrate,
        maxFramerate: settings.frameRate,
        priority: 'high',
        networkPriority: 'high',
      }],
      codecOptions: {
        videoGoogleStartBitrate: 10000,
      },
    });

    // Produce screen audio if the user shared a tab/window with audio.
    // Sent raw — no userspace echo cancellation. Viewers on speakers will
    // hear themselves echo back; headphones avoid that loop entirely.
    const audioTrack = this.screenStream.getAudioTracks()[0];
    if (audioTrack) {
      // Screen audio is typically music/game audio — opposite profile to mic.
      // Stereo on, DTX off (continuous content), higher bitrate for fidelity.
      this.screenAudioProducer = await this.sendTransport.produce({
        track: audioTrack,
        appData: { source: 'screen-audio' },
        codecOptions: {
          opusStereo: true,
          opusDtx: false,
          opusFec: true,
          opusMaxAverageBitrate: 128000,
        },
      });
    }

    if (this.localUsername) {
      this.handlers.onScreenTrack(this.localUsername, screenTrack);
    }
  }

  async stopScreenShare() {
    if (!this.screenProducer || !this.channelId) return;

    // Close screen audio producer first
    if (this.screenAudioProducer) {
      const audioProducerId = this.screenAudioProducer.id;
      try { await request(this.ws, 'close-producer', { channelId: this.channelId, producerId: audioProducerId }); } catch {}
      this.screenAudioProducer.close();
      this.screenAudioProducer = null;
    }

    const producerId = this.screenProducer.id;
    try {
      await request(this.ws, 'close-producer', { channelId: this.channelId, producerId });
    } catch {}

    this.screenProducer.close();
    this.screenProducer = null;

    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;

    if (this.localUsername) {
      this.handlers.onScreenTrack(this.localUsername, null);
    }
  }

  async leave(notifyServer = true) {
    this.stopLevelMonitoring();

    // Stop camera and screen hardware
    this.videoStream?.getTracks().forEach((t) => t.stop());
    this.videoStream = null;
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;

    // Notify React to clear every remote track in one pass over producerSources.
    for (const [producerId, source] of this.producerSources) {
      const username = this.producerUsernames.get(producerId);
      if (!username) continue;
      if (source === 'camera') this.handlers.onVideoTrack(username, null);
      else if (source === 'screen') this.handlers.onScreenTrack(username, null);
      else if (source === 'screen-audio') this.handlers.onScreenAudioChange(username, false);
    }
    if (this.localUsername) {
      if (this.videoProducer) this.handlers.onVideoTrack(this.localUsername, null);
      if (this.screenProducer) this.handlers.onScreenTrack(this.localUsername, null);
    }
    this.screenAudioElements.forEach((a) => { a.srcObject = null; });
    this.screenAudioElements.clear();
    this.producerSources.clear();

    // Notify server, but don't let a dead WebSocket block cleanup
    if (notifyServer && this.channelId) {
      try { await request(this.ws, 'leave', { channelId: this.channelId }); } catch {}
    }
    this.audioProducer?.close();
    this.videoProducer?.close();
    this.screenProducer?.close();
    this.screenAudioProducer?.close();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.consumers.forEach((c) => c.close());
    this.consumers.clear();
    this.userGainNodes.forEach((g) => g.disconnect());
    this.userGainNodes.clear();
    this.trackPumpers.forEach((p) => { p.srcObject = null; p.remove(); });
    this.trackPumpers.clear();
    this.userBaseVolumes.clear();
    this.userMutedState.clear();
    this.masterGainNode?.disconnect();
    this.masterGainNode = null;
    // Stop Silero before releasing the mic stream so destroy() doesn't fire
    // callbacks into a half-torn-down graph.
    if (this.micVAD) { try { await this.micVAD.destroy(); } catch {} }
    this.micVAD = null;
    this.micVADPromise = null;
    this.silenceDetected = true;
    this.rawMicStream?.getTracks().forEach((t) => t.stop());
    this.rawMicStream = null;
    this.eqNodes.forEach((n) => n.disconnect());
    this.eqNodes = [];
    this.rnnoiseNode?.disconnect();
    try { (this.rnnoiseNode as any)?.destroy?.(); } catch {}
    this.rnnoiseNode = null;
    this.rnnoiseWasmBinary = null;
    this.rnnoiseWorkletPromise = null;
    this.micGainNode = null;
    this.vadGateNode = null;
    this.micDestination = null;
    this.pttHeld = false;
    this.audioProducer = null;
    this.videoProducer = null;
    this.screenProducer = null;
    this.screenAudioProducer = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.channelId = null;
    this.localUsername = null;
  }

  private createAudioElement(): HTMLAudioElement {
    const audio = new Audio();
    const outputDevice = localStorage.getItem("preferredOutputDevice");
    if (outputDevice && 'setSinkId' in audio) {
      (audio as any).setSinkId(outputDevice).catch(() => {});
    }
    return audio;
  }

  setScreenAudioVolume(username: string, volume: number) {
    const audio = this.screenAudioElements.get(username);
    if (audio) audio.volume = Math.max(0, Math.min(1, volume));
  }

  setScreenAudioMuted(username: string, muted: boolean) {
    const audio = this.screenAudioElements.get(username);
    if (audio) audio.muted = muted;
  }

  setUserVolume(username: string, volume: number) {
    this.userBaseVolumes.set(username, volume);
    this.applyUserGain(username);
  }

  setUserMuted(username: string, muted: boolean) {
    this.userMutedState.set(username, muted);
    this.applyUserGain(username);
  }

  async switchAudioDevice(deviceId: string) {
    if (!this.audioProducer || !this.sendTransport) return;
    // Silero is bound to the old mic stream — tear it down before we stop
    // the tracks, then reinitialize after the new stream is live.
    if (this.micVAD) { try { await this.micVAD.destroy(); } catch {} }
    this.micVAD = null;
    this.micVADPromise = null;
    // Release the old mic hardware before grabbing the new one
    this.rawMicStream?.getTracks().forEach((t) => t.stop());
    // See join() for why echo / noise flags are disabled (Windows ducking).
    this.rawMicStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId && { deviceId: { exact: deviceId } }),
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
        channelCount: 1,
        sampleRate: 48000,
      },
    });
    const gatedTrack = await this.buildMicGraph(this.rawMicStream);
    await this.audioProducer.replaceTrack({ track: gatedTrack });
    this.ensureMicVAD();

    // Rebuild local mic analyser on the raw stream
    if (this.localUsername && this.audioContext) {
      this.analysers.delete(this.localUsername);
      const source = this.audioContext.createMediaStreamSource(this.rawMicStream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      this.analysers.set(this.localUsername, analyser);
    }
  }

  setMicGain(gain: number) {
    this.micGain = gain;
    localStorage.setItem('micGain', String(gain));
    if (this.micGainNode) this.micGainNode.gain.value = gain;
  }

  setSpeakerGain(gain: number) {
    this.speakerGain = gain;
    localStorage.setItem('speakerGain', String(gain));
    for (const username of this.userGainNodes.keys()) {
      this.applyUserGain(username);
    }
  }

  setRnnoiseEnabled(enabled: boolean) {
    this.rnnoiseEnabled = enabled;
    localStorage.setItem('rnnoiseEnabled', String(enabled));
    // Rebuild the mic graph and swap the outgoing track. Silero is fed by
    // the raw mic stream so it doesn't need to rewire.
    if (this.audioProducer && this.rawMicStream) {
      this.buildMicGraph(this.rawMicStream).then((track) => {
        return this.audioProducer?.replaceTrack({ track });
      }).catch(() => {});
    }
  }

  setMicEqEnabled(enabled: boolean) {
    this.eqEnabled = enabled;
    localStorage.setItem('micEqEnabled', String(enabled));
    // Re-apply band gains — zero them when disabled for transparent passthrough.
    this.eqNodes.forEach((filter, i) => {
      filter.gain.value = enabled ? this.eqBands[i].gain : 0;
    });
  }

  setEqBand(index: number, gain: number, q: number) {
    if (index < 0 || index >= EQ_FREQS.length) return;
    this.eqBands[index] = { gain, q };
    localStorage.setItem('micEqBands', JSON.stringify(this.eqBands));
    const filter = this.eqNodes[index];
    if (filter) {
      filter.gain.value = this.eqEnabled ? gain : 0;
      filter.Q.value = q;
    }
  }

  getMicDestinationStream(): MediaStream | null {
    return this.micDestination?.stream ?? null;
  }

  setVadMode(mode: 'off' | 'auto') {
    this.vadMode = mode;
    localStorage.setItem('vadMode', mode);
    if (mode === 'auto') {
      // Lazy-init Silero the first time auto mode is selected while in a
      // call. Closes the gate immediately until the model reports speech.
      this.silenceDetected = true;
      this.ensureMicVAD();
    }
    this.updateVadGate();
  }

  setPttEnabled(enabled: boolean) {
    this.pttEnabled = enabled;
    this.pttHeld = false;
    localStorage.setItem('pttEnabled', String(enabled));
    this.updateVadGate();
  }

  setPttKey(key: string) {
    this.pttKey = key;
    localStorage.setItem('pttKey', key);
  }

  async switchOutputDevice(deviceId: string) {
    if (this.audioContext && 'setSinkId' in this.audioContext) {
      await (this.audioContext as any).setSinkId(deviceId);
    }
    for (const audio of this.screenAudioElements.values()) {
      if ('setSinkId' in audio) {
        await (audio as any).setSinkId(deviceId);
      }
    }
  }

  async switchVideoDevice(deviceId: string) {
    if (!this.videoProducer || !this.sendTransport) return;
    // Stop old camera hardware
    this.videoStream?.getTracks().forEach((t) => t.stop());
    this.videoStream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
    const newTrack = this.videoStream.getVideoTracks()[0];
    await this.videoProducer.replaceTrack({ track: newTrack });
    if (this.localUsername) {
      this.handlers.onVideoTrack(this.localUsername, newTrack);
    }
  }

  setDeafened(deafened: boolean) {
    if (this.masterGainNode) this.masterGainNode.gain.value = deafened ? 0 : 1;
    for (const audio of this.screenAudioElements.values()) {
      audio.muted = deafened;
    }
  }

  destroy() {
    window.removeEventListener('keydown', this.keyDownHandler);
    window.removeEventListener('keyup', this.keyUpHandler);
    this.ws.removeEventListener('message', this.notificationHandler);
  }
}
