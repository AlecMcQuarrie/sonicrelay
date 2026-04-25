import { Device } from 'mediasoup-client';
import type { types } from 'mediasoup-client';
import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import { MicVAD } from '@ricky0123/vad-web';
import { LoudnessWorkletNode } from 'loudness-worklet';

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

// Target playback loudness for LUFS-based per-peer normalization. Discord-ish.
const LUFS_TARGET = -20;
// Clamp per-peer normalization gain so a momentarily silent peer can't blow
// out everyone's speakers when they start talking.
const LUFS_GAIN_MIN = 0.25;
const LUFS_GAIN_MAX = 4.0;

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
  private limiterNode: DynamicsCompressorNode | null = null;
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
  private micVAD: MicVAD | null = null;
  private micVADPromise: Promise<void> | null = null;
  private userBaseVolumes = new Map<string, number>(); // username -> 0..2 (pre-speakerGain)
  private userMutedState = new Map<string, boolean>(); // username -> muted
  private userGainNodes = new Map<string, GainNode>(); // username -> receive gain
  private trackPumpers = new Map<string, HTMLAudioElement>(); // muted <audio> per user that keeps WebRTC tracks flowing into Web Audio
  // Per-peer LUFS normalization state.
  private loudnessNodes = new Map<string, AudioWorkletNode>(); // username -> BS.1770 worklet
  private normalizationFactors = new Map<string, number>(); // username -> 0.25..4.0 gain multiplier
  private loudnessWorkletPromise: Promise<void> | null = null;
  // RNNoise state. Lazy-loaded on first mic graph build; cached thereafter.
  private rnnoiseEnabled = true;
  private rnnoiseNode: AudioWorkletNode | null = null;
  private rnnoiseWasmBinary: ArrayBuffer | null = null;
  private rnnoiseWorkletPromise: Promise<void> | null = null;
  private masterGainNode: GainNode | null = null;
  // Tap off the peer-voice mix (post-master, same signal the speakers play)
  // so startScreenShare can cancel it out of the system loopback capture —
  // viewers don't hear themselves echoed through the shared screen audio.
  // See buildAecTrack() for the NLMS filter that does the actual cancellation.
  private voiceMixDest: MediaStreamAudioDestinationNode | null = null;
  private aecWorkletPromise: Promise<void> | null = null;
  private aecNodes: AudioNode[] = [];
  private aecStream: MediaStream | null = null;
  // Coarse-delay alignment: the system loopback round-trip (50–250 ms) usually
  // exceeds the NLMS tap window (2048 samples = 42 ms at 48 kHz). A DelayNode
  // on the reference path shifts the reference to line up with the actual
  // echo, leaving the filter free to model just the residual tail.
  private aecRefDelay: DelayNode | null = null;
  private aecMeasureNodes: AudioNode[] = [];
  private aecRefBuffer: Float32Array | null = null;
  private aecCapBuffer: Float32Array | null = null;
  private aecBufferWrite = 0;
  private aecBufferFilled = 0;
  private aecLastMeasure = 0;
  private normalizeVoices = true;
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
    // Default ON when no stored value — existing users who explicitly turned
    // normalization off keep their preference.
    const storedNormalize = localStorage.getItem('normalizeVoices');
    this.normalizeVoices = storedNormalize === null ? true : storedNormalize === 'true';
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
      // whose gain is driven by per-peer LUFS measurement when normalization
      // is enabled (see consumeProducer / updateNormalizationFactor). All
      // per-peer gains sum into masterGain, then pass through a brickwall
      // limiter before hitting the destination.
      //
      // Final output goes through audioContext.destination — avoiding an
      // <audio> element here is deliberate: Chrome's tab-audio capture
      // (getDisplayMedia with audio: true) includes DOM-attached media
      // elements before setSinkId routing, so an <audio> sink would leak
      // the received voice back into our own screen-share audio.
      this.masterGainNode = this.audioContext.createGain();
      this.masterGainNode.gain.value = 1; // deafen sets to 0
      // Brickwall limiter on the master bus. With per-peer LUFS gains
      // clamped to [0.25, 4.0] and per-user volume sliders on top, summed
      // peaks can still overshoot ±1.0 — the limiter keeps the destination
      // honest without audible pumping on single-speaker content.
      this.limiterNode = this.audioContext.createDynamicsCompressor();
      this.limiterNode.threshold.value = -1;
      this.limiterNode.knee.value = 0;
      this.limiterNode.ratio.value = 20;
      this.limiterNode.attack.value = 0.001;
      this.limiterNode.release.value = 0.05;
      this.masterGainNode.connect(this.limiterNode);
      this.limiterNode.connect(this.audioContext.destination);

      // LUFS worklet module load — shared across every per-peer instance
      // created in consumeProducer. Deferred cached promise mirrors the
      // pattern used for the AEC and RNNoise worklets.
      this.loudnessWorkletPromise = LoudnessWorkletNode.loadModule(this.audioContext).catch(() => {
        // If the module fails to load, per-peer normalization silently
        // falls back to unity gain — speech still plays, just not LUFS-leveled.
      });
      // Second output branch: peer-voice mix as a MediaStream. Used only
      // while screen-sharing with audio to subtract our own received voices
      // from the loopback capture (mix-minus).
      this.voiceMixDest = this.audioContext.createMediaStreamDestination();
      this.masterGainNode.connect(this.voiceMixDest);

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
    // the per-user GainNode, a BS.1770 loudness meter (for normalization),
    // and an analyser (for the speaking indicator).
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

      // Per-peer LUFS meter. Independent per-peer measurement means one
      // loud peer can't duck everyone else the way the old shared
      // compressor did. The meter runs in parallel with playback — it
      // only reads; output still flows gainNode → masterGain.
      if (this.loudnessWorkletPromise) {
        const captureUsername = remoteUsername;
        this.loudnessWorkletPromise.then(() => {
          if (!this.audioContext || this.userGainNodes.get(captureUsername) !== gainNode) return;
          try {
            const meter = new LoudnessWorkletNode(this.audioContext, {
              processorOptions: { interval: 0.4, capacity: 10 },
            });
            meter.port.onmessage = (event) => this.onLoudnessMessage(captureUsername, event.data);
            trackSource.connect(meter);
            this.loudnessNodes.set(captureUsername, meter);
          } catch {
            // Non-fatal: peer plays at unity normalization gain.
          }
        });
      }

      // Analyser tap for the speaking indicator, post per-peer gain so
      // boosting a quiet peer also boosts their indicator intensity.
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      gainNode.connect(analyser);
      this.analysers.set(remoteUsername, analyser);
    }
  }

  // Consume one LUFS snapshot from the per-peer worklet. We read the most
  // recent short-term loudness value and, when it's meaningful, nudge that
  // peer's normalization factor toward the gain that would put them at
  // LUFS_TARGET. The actual GainNode update is smoothed by applyUserGain
  // below (a setTargetAtTime ramp, not a step).
  private onLoudnessMessage(username: string, data: any) {
    if (!this.normalizeVoices) return;
    const ms: Array<{ shortTermLoudness: number }> | undefined = data?.currentMeasurements;
    if (!ms || ms.length === 0) return;
    const last = ms[ms.length - 1];
    const lufs = last?.shortTermLoudness;
    // BS.1770 returns −Infinity / very negative values for silence; ignore.
    if (!Number.isFinite(lufs) || lufs < -60) return;
    const rawFactor = Math.pow(10, (LUFS_TARGET - lufs) / 20);
    const clamped = Math.max(LUFS_GAIN_MIN, Math.min(LUFS_GAIN_MAX, rawFactor));
    const prev = this.normalizationFactors.get(username) ?? 1;
    // Slew limit — blend 25 % of the new estimate per 400 ms tick so the
    // factor settles over a few seconds without pumping.
    const next = prev * 0.75 + clamped * 0.25;
    this.normalizationFactors.set(username, next);
    this.applyUserGain(username);
  }

  private applyUserGain(username: string) {
    const node = this.userGainNodes.get(username);
    if (!node || !this.audioContext) return;
    const muted = this.userMutedState.get(username) ?? false;
    const base = this.userBaseVolumes.get(username) ?? 1;
    const norm = this.normalizeVoices ? (this.normalizationFactors.get(username) ?? 1) : 1;
    const target = muted ? 0 : base * this.speakerGain * norm;
    // Smooth ramp instead of a step avoids zipper noise when the LUFS
    // estimate updates and keeps manual volume-slider drags glitch-free.
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

  // NLMS adaptive filter in an AudioWorklet. Reference = peer voice mix
  // (pre-speaker, same signal we play). Capture = system loopback track
  // from getDisplayMedia. The filter learns the full impulse response
  // (delay + per-app volume + any frequency shaping) from reference to
  // capture, and emits capture − filtered(reference). Handles what the
  // old single-tap "delay + invert + scale" approach couldn't: loopback
  // paths with non-trivial frequency response, and the slow/unreliable
  // convergence of a cross-correlation latency seeker.
  //
  // 2048 taps at 48 kHz = ~43 ms of impulse response. The bulk round-trip
  // delay (30–250 ms) is absorbed by a separately-driven DelayNode on the
  // reference path; the filter's taps need only cover the residual tail.
  //
  // Runs inside AudioWorkletGlobalScope — no closures over outer scope,
  // no imports. If any of that changes, the source must remain a plain
  // string because AudioWorklet modules load as separate scripts.
  private static readonly AEC_WORKLET_SOURCE = `
class NlmsAec extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const N = (opts && opts.processorOptions && opts.processorOptions.N) || 1024;
    this.N = N;
    this.buf = new Float32Array(N);
    this.w = new Float32Array(N);
    this.widx = 0;
    this.refEnergy = 0;
    this.mu = 0.15;
    this.eps = 1e-6;
    // Weight leakage per sample. Prevents unbounded growth when the
    // filter sees signal it can't explain (game audio, mic bleed, etc.).
    // 1 - 1e-5 → weights decay to half over ~70k samples (~1.5s) if the
    // reference ever goes fully silent or uncorrelated with capture.
    this.leak = 1 - 1e-5;
    // Reference energy threshold below which we freeze adaptation.
    // Without this, NLMS tries to fit uncorrelated capture to residual
    // reference noise — weights grow and the "cancelled" output ends up
    // amplifying game audio to painful levels. Units: sum-of-squares
    // across the N-sample buffer. N * 1e-5 → ~ -40 dBFS.
    this.refThresh = N * 1e-5;
  }
  process(inputs, outputs) {
    const ref = inputs[0] && inputs[0][0];
    const cap = inputs[1] && inputs[1][0];
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const len = out.length;
    if (!cap) { for (let i = 0; i < len; i++) out[i] = 0; return true; }
    // No reference available: pass capture through untouched. Never amplify.
    if (!ref) { for (let i = 0; i < len; i++) out[i] = cap[i]; return true; }
    const N = this.N;
    const buf = this.buf;
    const w = this.w;
    let widx = this.widx;
    let refE = this.refEnergy;
    const leak = this.leak;
    const thresh = this.refThresh;
    const mu = this.mu;
    const eps = this.eps;

    for (let n = 0; n < len; n++) {
      const x = ref[n];
      const oldX = buf[widx];
      refE += x * x - oldX * oldX;
      if (refE < 0) refE = 0;
      buf[widx] = x;

      // FIR: y = sum(w[i] * buf[widx - i])
      let y = 0;
      let j = widx;
      for (let i = 0; i < N; i++) {
        y += w[i] * buf[j];
        j = (j === 0) ? N - 1 : j - 1;
      }

      const c = cap[n];
      let e = c - y;

      // Divergence guard. If the filter predicts something much larger
      // than capture, the cancelled signal becomes louder than the
      // original — painful for viewers. Clamp to capture in that case
      // and let leakage bleed the offending weights down.
      if (Math.abs(e) > 2 * Math.abs(c) + 0.02) e = c;
      out[n] = e;

      // Adapt weights only when the reference is non-trivial. Freezing
      // during double-talk / reference silence is what prevents the
      // amplify-random-audio failure mode.
      if (refE > thresh) {
        const step = mu / (refE + eps);
        j = widx;
        for (let i = 0; i < N; i++) {
          w[i] = leak * w[i] + step * e * buf[j];
          j = (j === 0) ? N - 1 : j - 1;
        }
      } else {
        // Reference quiet — leak weights toward zero so a stale learned
        // filter doesn't keep colouring the capture after peers stopped.
        for (let i = 0; i < N; i++) w[i] *= leak;
      }

      widx = (widx + 1) % N;
    }

    this.widx = widx;
    this.refEnergy = refE;
    return true;
  }
}
registerProcessor('nlms-aec', NlmsAec);
`;

  // Worklet registration is async and required before the AudioWorkletNode
  // can be constructed. Cached on first build so subsequent screen shares
  // don't re-register.
  private ensureAecWorklet(): Promise<void> {
    if (this.aecWorkletPromise) return this.aecWorkletPromise;
    const ctx = this.audioContext;
    if (!ctx) return Promise.reject(new Error('AudioContext not initialized'));
    const blob = new Blob([VoiceClient.AEC_WORKLET_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    this.aecWorkletPromise = ctx.audioWorklet.addModule(url).finally(() => {
      URL.revokeObjectURL(url);
    });
    return this.aecWorkletPromise;
  }

  private async buildAecTrack(loopbackTrack: MediaStreamTrack): Promise<MediaStreamTrack | null> {
    const ctx = this.audioContext;
    const voiceMix = this.voiceMixDest;
    if (!ctx || !voiceMix) return null;
    try {
      await this.ensureAecWorklet();
      this.tearDownAec();
      const loopbackSource = ctx.createMediaStreamSource(new MediaStream([loopbackTrack]));
      const voiceSource = ctx.createMediaStreamSource(voiceMix.stream);
      // DelayNode on the reference path. Coarse delay estimator will set
      // this to roughly the measured loopback round-trip minus a small
      // safety margin, so the filter's 2048 taps land on the echo tail
      // instead of being consumed by the bulk delay.
      const refDelay = ctx.createDelay(0.5);
      refDelay.delayTime.value = 0;
      const aec = new AudioWorkletNode(ctx, 'nlms-aec', {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { N: 2048 },
      });
      const dest = ctx.createMediaStreamDestination();
      voiceSource.connect(refDelay);
      refDelay.connect(aec, 0, 0);
      loopbackSource.connect(aec, 0, 1);
      aec.connect(dest);
      const outTrack = dest.stream.getAudioTracks()[0];
      if (!outTrack) return null;
      this.aecRefDelay = refDelay;
      this.aecNodes = [loopbackSource, voiceSource, refDelay, aec, dest];
      this.aecStream = dest.stream;
      this.installAecDelayMeasurer(voiceSource, loopbackSource);
      return outTrack;
    } catch {
      this.tearDownAec();
      return null;
    }
  }

  // Coarse cross-correlation delay estimator. Taps the same reference and
  // loopback streams the NLMS worklet uses, writes them into ring buffers,
  // and periodically correlates to find the round-trip delay. Runs only
  // when the reference has meaningful energy (peers talking) — correlating
  // silence yields random peaks.
  private installAecDelayMeasurer(voiceSource: AudioNode, loopbackSource: AudioNode) {
    const ctx = this.audioContext;
    if (!ctx) return;
    try {
      const BUFFER_SAMPLES = Math.round(ctx.sampleRate * 0.5); // 500 ms window
      this.aecRefBuffer = new Float32Array(BUFFER_SAMPLES);
      this.aecCapBuffer = new Float32Array(BUFFER_SAMPLES);
      this.aecBufferWrite = 0;
      this.aecBufferFilled = 0;
      this.aecLastMeasure = 0;

      // ChannelMerger feeds both signals into one ScriptProcessor so
      // writes into the ring buffers stay sample-aligned.
      const merger = ctx.createChannelMerger(2);
      voiceSource.connect(merger, 0, 0);
      loopbackSource.connect(merger, 0, 1);
      // ScriptProcessor is deprecated but fine here: the per-block work
      // is a plain ring-buffer copy. Correlation runs off-thread via
      // queueMicrotask so it never blocks the audio callback.
      const proc = ctx.createScriptProcessor(4096, 2, 1);
      merger.connect(proc);
      // ScriptProcessor must connect to a live destination to pump.
      const silent = ctx.createGain();
      silent.gain.value = 0;
      proc.connect(silent);
      silent.connect(ctx.destination);

      proc.onaudioprocess = (event) => {
        const ref = event.inputBuffer.getChannelData(0);
        const cap = event.inputBuffer.getChannelData(1);
        const refBuf = this.aecRefBuffer;
        const capBuf = this.aecCapBuffer;
        if (!refBuf || !capBuf) return;
        const size = refBuf.length;
        let w = this.aecBufferWrite;
        for (let i = 0; i < ref.length; i++) {
          refBuf[w] = ref[i];
          capBuf[w] = cap[i];
          w = w + 1;
          if (w >= size) w = 0;
        }
        this.aecBufferWrite = w;
        this.aecBufferFilled = Math.min(this.aecBufferFilled + ref.length, size);

        const now = performance.now();
        if (this.aecBufferFilled >= size && now - this.aecLastMeasure > 2000) {
          this.aecLastMeasure = now;
          queueMicrotask(() => this.runAecDelayCorrelation());
        }
      };

      this.aecMeasureNodes = [merger, proc, silent];
    } catch {
      // Measurer failure is non-fatal; NLMS still runs at delayTime = 0.
    }
  }

  private runAecDelayCorrelation() {
    const ctx = this.audioContext;
    const ref = this.aecRefBuffer;
    const cap = this.aecCapBuffer;
    const delayNode = this.aecRefDelay;
    if (!ctx || !ref || !cap || !delayNode) return;
    const size = ref.length;
    const sr = ctx.sampleRate;
    const write = this.aecBufferWrite;

    // Linearize the ring buffers so indexing matches time order.
    const lin = (src: Float32Array) => {
      const out = new Float32Array(size);
      const tailLen = size - write;
      out.set(src.subarray(write), 0);
      out.set(src.subarray(0, write), tailLen);
      return out;
    };
    const refLin = lin(ref);
    const capLin = lin(cap);

    // Energy gate: correlating silence produces random peaks that would
    // jitter the DelayNode for no gain.
    const gateWin = Math.min(size, Math.round(0.1 * sr));
    let rmsSq = 0;
    for (let i = size - gateWin; i < size; i++) rmsSq += refLin[i] * refLin[i];
    const rms = Math.sqrt(rmsSq / gateWin);
    if (rms < 0.005) return;

    // 100 ms correlation window against lags from 0 to 300 ms. Capture is
    // always delayed relative to reference, so we only search positive lag.
    const winSize = Math.round(0.1 * sr);
    const winStart = size - winSize;
    const minLag = 0;
    const maxLag = Math.min(winStart, Math.round(0.3 * sr));

    let bestLag = minLag;
    let bestCorr = -Infinity;
    let sumAbsCorr = 0;
    let samples = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const capStart = winStart - lag;
      let sum = 0;
      for (let j = 0; j < winSize; j++) {
        sum += refLin[winStart + j] * capLin[capStart + j];
      }
      sumAbsCorr += Math.abs(sum);
      samples++;
      if (sum > bestCorr) {
        bestCorr = sum;
        bestLag = lag;
      }
    }

    // Require the peak to stand clearly above the average absolute
    // correlation; otherwise we're fitting to noise.
    const meanAbs = samples > 0 ? sumAbsCorr / samples : 0;
    if (bestCorr < meanAbs * 4) return;

    // Measured lag = how much capture trails reference. Delay the reference
    // by (lag − safety) so the filter's taps start slightly ahead of the
    // echo onset and cover its tail.
    const measuredSec = bestLag / sr;
    const safetyMarginSec = 0.010; // 10 ms headroom for taps to pick up pre-echo
    const delaySec = Math.max(0, measuredSec - safetyMarginSec);
    try {
      delayNode.delayTime.cancelScheduledValues(ctx.currentTime);
      // Smooth ramp prevents a pitch wobble on whatever reference content
      // is currently being subtracted.
      delayNode.delayTime.setTargetAtTime(delaySec, ctx.currentTime, 0.25);
    } catch {}
  }

  private tearDownAec() {
    for (const n of this.aecNodes) { try { n.disconnect(); } catch {} }
    this.aecNodes = [];
    for (const n of this.aecMeasureNodes) {
      try { (n as ScriptProcessorNode).onaudioprocess = null as any; } catch {}
      try { n.disconnect(); } catch {}
    }
    this.aecMeasureNodes = [];
    this.aecRefDelay = null;
    this.aecRefBuffer = null;
    this.aecCapBuffer = null;
    this.aecBufferWrite = 0;
    this.aecBufferFilled = 0;
    this.aecLastMeasure = 0;
    this.aecStream?.getTracks().forEach((t) => t.stop());
    this.aecStream = null;
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
        const [wasm] = await Promise.all([
          loadRnnoise({ url: AUDIO_ASSETS.rnnoiseWasm, simdUrl: AUDIO_ASSETS.rnnoiseSimdWasm }),
          ctx.audioWorklet.addModule(AUDIO_ASSETS.rnnoiseWorklet),
        ]);
        this.rnnoiseWasmBinary = wasm;
      } catch {
        // Fatal for RNNoise but not for voice overall — mic graph falls
        // back to the non-RNNoise path if we can't construct the node.
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
    // Run it through an NLMS adaptive filter that cancels our own received
    // peer voices out of the loopback so viewers don't hear themselves in
    // the screen-share audio. See `voiceMixDest` for the tap point.
    const audioTrack = this.screenStream.getAudioTracks()[0];
    if (audioTrack) {
      // If AEC graph can't be built (no AudioWorklet support, audio context
      // closed), skip producing screen audio rather than sending raw
      // uncancelled loopback — the raw fallback guarantees peers hear
      // themselves.
      const outgoingTrack = await this.buildAecTrack(audioTrack);
      if (outgoingTrack) {
        // Screen audio is typically music/game audio — opposite profile to mic.
        // Stereo on, DTX off (continuous content), higher bitrate for fidelity.
        this.screenAudioProducer = await this.sendTransport.produce({
          track: outgoingTrack,
          appData: { source: 'screen-audio' },
          codecOptions: {
            opusStereo: true,
            opusDtx: false,
            opusFec: true,
            opusMaxAverageBitrate: 128000,
          },
        });
      }
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
    this.tearDownAec();

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
    this.tearDownAec();
    this.aecWorkletPromise = null;
    this.voiceMixDest?.disconnect();
    this.voiceMixDest = null;
    this.loudnessNodes.forEach((n) => { try { n.disconnect(); } catch {} });
    this.loudnessNodes.clear();
    this.normalizationFactors.clear();
    this.loudnessWorkletPromise = null;
    this.masterGainNode?.disconnect();
    this.masterGainNode = null;
    this.limiterNode?.disconnect();
    this.limiterNode = null;
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

  setNormalizeVoices(enabled: boolean) {
    this.normalizeVoices = enabled;
    localStorage.setItem('normalizeVoices', String(enabled));
    // When turning off, clear accumulated factors so turning back on
    // starts fresh at unity and ramps up via the next few LUFS updates.
    if (!enabled) this.normalizationFactors.clear();
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
