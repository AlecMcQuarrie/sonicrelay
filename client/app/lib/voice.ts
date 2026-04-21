import { Device } from 'mediasoup-client';
import type { types } from 'mediasoup-client';

// Fixed center frequencies for the 5-band mic EQ. Kept here (duplicated with
// settings.ts intentionally) so VoiceClient doesn't import UI/settings code.
const EQ_FREQS = [80, 250, 1000, 4000, 10000];
const EQ_TYPES: BiquadFilterType[] = ['lowshelf', 'peaking', 'peaking', 'peaking', 'highshelf'];

export type ScreenShareSettings = {
  resolution: 720 | 1080 | 1440;
  frameRate: 30 | 60;
};

// Bitrate targets by resolution and frame rate (matches Discord Nitro-tier quality)
const SCREEN_BITRATES: Record<string, number> = {
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
  private videoProducerIds = new Set<string>(); // producer IDs that are camera video
  private screenProducerIds = new Set<string>(); // producer IDs that are screen share video
  private screenAudioProducerIds = new Set<string>(); // producer IDs that are screen share audio
  private screenAudioElements = new Map<string, HTMLAudioElement>(); // username -> audio element
  private producerSources = new Map<string, string>(); // producerId -> 'camera' | 'screen' | 'screen-audio'
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
  private vadMode: 'off' | 'auto' | 'manual' = 'off';
  private vadThreshold = 30;
  private vadNoiseFloor = 3;
  private vadHangoverUntil = 0; // timestamp until which auto-VAD keeps the gate open
  private pttEnabled = false;
  private pttKey = '';
  private pttHeld = false;
  private lastLocalRms = 0; // 0..100, scaled from byte-domain RMS
  private userBaseVolumes = new Map<string, number>(); // username -> 0..2 (pre-speakerGain)
  private userMutedState = new Map<string, boolean>(); // username -> muted
  private userGainNodes = new Map<string, GainNode>(); // username -> receive gain
  private trackPumpers = new Map<string, HTMLAudioElement>(); // muted <audio> per user that keeps WebRTC tracks flowing into Web Audio
  private compressorNode: DynamicsCompressorNode | null = null;
  private makeupGainNode: GainNode | null = null;
  private masterGainNode: GainNode | null = null;
  // Tap off the peer-voice mix (post-master, same signal the speakers play)
  // so startScreenShare can phase-invert it against the system loopback
  // capture — cancels our own received voices out of the outgoing screen
  // audio so viewers don't hear themselves. See startScreenShare().
  private voiceMixDest: MediaStreamAudioDestinationNode | null = null;
  private mixMinusNodes: AudioNode[] = [];
  private mixMinusStream: MediaStream | null = null;
  private mixMinusDelay: DelayNode | null = null;
  // Passive latency measurer: cross-correlates the peer-voice reference
  // against the loopback capture to figure out the exact delay to set on
  // mixMinusDelay. Runs whenever peers are talking; no probe injected.
  private latencyMeasurerNodes: AudioNode[] = [];
  private latencyRefBuffer: Float32Array | null = null;
  private latencyCapBuffer: Float32Array | null = null;
  private latencyBufferWrite = 0;
  private latencyBufferFilled = 0;
  private latencyLastUpdate = 0;
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
    if (storedMode === 'off' || storedMode === 'auto' || storedMode === 'manual') this.vadMode = storedMode;
    this.vadThreshold = parseFloat(localStorage.getItem('vadThreshold') ?? '30');
    this.pttEnabled = localStorage.getItem('pttEnabled') === 'true';
    this.pttKey = localStorage.getItem('pttKey') ?? '';
    // Default ON when no stored value — existing users who explicitly turned
    // normalization off keep their preference.
    const storedNormalize = localStorage.getItem('normalizeVoices');
    this.normalizeVoices = storedNormalize === null ? true : storedNormalize === 'true';
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
      this.audioContext = new AudioContext();
      // Browsers may start AudioContext in suspended state — resume it
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Shared receive graph: every remote mic feeds one GainNode per user,
      // which routes into either the compressor chain or straight to the
      // master gain depending on the "Normalize voices" toggle. Final output
      // goes through audioContext.destination — avoiding an <audio> element
      // here is deliberate: Chrome's tab-audio capture (getDisplayMedia with
      // audio: true) includes DOM-attached media elements before setSinkId
      // routing, so an <audio> sink would leak the received voice back into
      // our own screen-share audio.
      this.compressorNode = this.audioContext.createDynamicsCompressor();
      this.compressorNode.threshold.value = -18;
      this.compressorNode.knee.value = 20;
      this.compressorNode.ratio.value = 4;
      this.compressorNode.attack.value = 0.003;
      this.compressorNode.release.value = 0.25;
      this.makeupGainNode = this.audioContext.createGain();
      this.makeupGainNode.gain.value = 2;
      this.masterGainNode = this.audioContext.createGain();
      this.masterGainNode.gain.value = 1; // deafen sets to 0
      this.compressorNode.connect(this.makeupGainNode);
      this.makeupGainNode.connect(this.masterGainNode);
      this.masterGainNode.connect(this.audioContext.destination);
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
      // Web Audio graph (source → micGain → vadGate → destination) so master
      // volume, VAD, and PTT can be applied before the track reaches mediasoup.
      // autoGainControl: false — Chromium's AGC silently lowers input gain mid-session on
      // USB interfaces like the Wave XLR. Let the hardware/mixer software handle levels.
      const preferredAudio = localStorage.getItem("preferredAudioDevice");
      try {
        this.rawMicStream = await navigator.mediaDevices.getUserMedia({
          audio: { ...(preferredAudio && { deviceId: { exact: preferredAudio } }), autoGainControl: false },
        });
      } catch (err) {
        // Stored device is gone or no longer matches — drop it and use default.
        if (preferredAudio) localStorage.removeItem("preferredAudioDevice");
        this.rawMicStream = await navigator.mediaDevices.getUserMedia({
          audio: { autoGainControl: false },
        });
      }
      const gatedTrack = this.buildMicGraph(this.rawMicStream);
      this.audioProducer = await this.sendTransport.produce({ track: gatedTrack });

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
    const source = this.producerSources.get(producerId) || 'camera';

    if (consumer.kind === 'video') {
      if (source === 'screen') {
        this.screenProducerIds.add(producerId);
        if (remoteUsername) this.handlers.onScreenTrack(remoteUsername, consumer.track);
      } else {
        this.videoProducerIds.add(producerId);
        if (remoteUsername) this.handlers.onVideoTrack(remoteUsername, consumer.track);
      }
      return;
    }

    // Screen share audio — track separately for per-user volume control
    if (source === 'screen-audio' && remoteUsername) {
      this.screenAudioProducerIds.add(producerId);
      const audio = this.createAudioElement();
      audio.srcObject = new MediaStream([consumer.track]);
      audio.play();
      this.screenAudioElements.set(remoteUsername, audio);
      this.handlers.onScreenAudioChange(remoteUsername, true);
      return;
    }

    // Route received mic audio through the shared receive graph. One source feeds
    // both the per-user GainNode and the level-monitoring analyser.
    if (remoteUsername && this.audioContext && this.masterGainNode) {
      // Chromium won't deliver audio from a WebRTC-sourced track into
      // createMediaStreamSource unless an <audio> element is actively playing
      // that track — otherwise the graph outputs silence. Create a muted,
      // DOM-attached pump element per peer. Audible output still comes from
      // the Web Audio graph feeding voiceAudio.
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
      this.applyUserGain(remoteUsername);
      this.routeUserGain(gainNode);

      // Tap the analyser off the per-user GainNode (post-volume) so the
      // speaking indicator intensity tracks what this listener actually hears
      // — boosting a quiet peer also boosts their indicator. Kept as a
      // permanent connection; routeUserGain only re-wires the main output.
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      gainNode.connect(analyser);
      this.analysers.set(remoteUsername, analyser);
    }
  }

  private routeUserGain(gainNode: GainNode) {
    // Only touch the main output edges; leave the analyser tap alone. The
    // targeted disconnect throws if not currently connected — swallow that.
    if (this.compressorNode) { try { gainNode.disconnect(this.compressorNode); } catch {} }
    if (this.masterGainNode) { try { gainNode.disconnect(this.masterGainNode); } catch {} }
    if (this.normalizeVoices && this.compressorNode) {
      gainNode.connect(this.compressorNode);
    } else if (this.masterGainNode) {
      gainNode.connect(this.masterGainNode);
    }
  }

  private applyUserGain(username: string) {
    const node = this.userGainNodes.get(username);
    if (!node) return;
    const muted = this.userMutedState.get(username) ?? false;
    const base = this.userBaseVolumes.get(username) ?? 1;
    node.gain.value = muted ? 0 : base * this.speakerGain;
  }

  private removeProducer(producerId: string) {
    const consumer = this.consumers.get(producerId);
    if (consumer) {
      consumer.close();
      this.consumers.delete(producerId);
    }

    const username = this.producerUsernames.get(producerId);

    if (this.screenAudioProducerIds.has(producerId)) {
      this.screenAudioProducerIds.delete(producerId);
      if (username) {
        const audio = this.screenAudioElements.get(username);
        if (audio) { audio.srcObject = null; this.screenAudioElements.delete(username); }
        this.handlers.onScreenAudioChange(username, false);
      }
    } else if (this.screenProducerIds.has(producerId)) {
      this.screenProducerIds.delete(producerId);
      if (username) this.handlers.onScreenTrack(username, null);
    } else if (this.videoProducerIds.has(producerId)) {
      this.videoProducerIds.delete(producerId);
      if (username) this.handlers.onVideoTrack(username, null);
    } else {
      if (username) {
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
    }

    if (username) this.producerUsernames.delete(producerId);
    this.producerSources.delete(producerId);
  }

  // Mix-minus: outgoing screen audio = loopback capture - (peer voice mix).
  // We phase-invert the peer voice tap, delay it to match the loopback
  // round-trip, then sum with the loopback. Residual = game/app audio
  // minus the peers we're playing. Initial delay is seeded from the
  // browser-reported output latency; installLatencyMeasurer refines it
  // live by cross-correlating the reference against the capture whenever
  // peers are actually talking.
  private buildMixMinusTrack(loopbackTrack: MediaStreamTrack): MediaStreamTrack | null {
    const ctx = this.audioContext;
    const voiceMix = this.voiceMixDest;
    if (!ctx || !voiceMix) return null;
    try {
      this.tearDownMixMinus();
      const loopbackStream = new MediaStream([loopbackTrack]);
      const loopbackSource = ctx.createMediaStreamSource(loopbackStream);
      const voiceSource = ctx.createMediaStreamSource(voiceMix.stream);
      const delay = ctx.createDelay(1);
      const reportedLatency = (ctx as any).outputLatency;
      const initial = typeof reportedLatency === 'number' && reportedLatency > 0
        ? Math.max(0.02, Math.min(0.3, reportedLatency * 2))
        : 0.06;
      delay.delayTime.value = initial;
      const inverter = ctx.createGain();
      inverter.gain.value = -1;
      const summer = ctx.createGain();
      summer.gain.value = 1;
      const dest = ctx.createMediaStreamDestination();
      loopbackSource.connect(summer);
      voiceSource.connect(delay).connect(inverter).connect(summer);
      summer.connect(dest);
      const outTrack = dest.stream.getAudioTracks()[0];
      if (!outTrack) return null;
      this.mixMinusDelay = delay;
      this.mixMinusNodes = [loopbackSource, voiceSource, delay, inverter, summer, dest];
      this.mixMinusStream = dest.stream;
      this.installLatencyMeasurer(voiceSource, loopbackSource);
      return outTrack;
    } catch {
      this.tearDownMixMinus();
      return null;
    }
  }

  // Taps the same voice-mix reference and loopback streams the mix-minus
  // uses, copies them into ring buffers via a ScriptProcessorNode, and
  // periodically cross-correlates to find the real round-trip delay.
  private installLatencyMeasurer(voiceSource: AudioNode, loopbackSource: AudioNode) {
    const ctx = this.audioContext;
    if (!ctx) return;
    try {
      const BUFFER_SAMPLES = Math.round(ctx.sampleRate * 0.5); // 500ms window
      this.latencyRefBuffer = new Float32Array(BUFFER_SAMPLES);
      this.latencyCapBuffer = new Float32Array(BUFFER_SAMPLES);
      this.latencyBufferWrite = 0;
      this.latencyBufferFilled = 0;
      this.latencyLastUpdate = 0;

      // Merge ref + capture into a single 2-channel stream so one
      // ScriptProcessor can see both with aligned timing.
      const merger = ctx.createChannelMerger(2);
      voiceSource.connect(merger, 0, 0);
      loopbackSource.connect(merger, 0, 1);
      // ScriptProcessor is deprecated but universally supported in Electron
      // and avoids the overhead of loading an AudioWorklet module. The work
      // on the audio thread is trivial (ring-buffer copy); correlation runs
      // on the main thread via queueMicrotask.
      const proc = ctx.createScriptProcessor(4096, 2, 1);
      merger.connect(proc);
      const silent = ctx.createGain();
      silent.gain.value = 0;
      proc.connect(silent);
      silent.connect(ctx.destination);

      proc.onaudioprocess = (event) => {
        const ref = event.inputBuffer.getChannelData(0);
        const cap = event.inputBuffer.getChannelData(1);
        const refBuf = this.latencyRefBuffer;
        const capBuf = this.latencyCapBuffer;
        if (!refBuf || !capBuf) return;
        const size = refBuf.length;
        let w = this.latencyBufferWrite;
        for (let i = 0; i < ref.length; i++) {
          refBuf[w] = ref[i];
          capBuf[w] = cap[i];
          w = w + 1;
          if (w >= size) w = 0;
        }
        this.latencyBufferWrite = w;
        this.latencyBufferFilled = Math.min(this.latencyBufferFilled + ref.length, size);

        const now = performance.now();
        if (this.latencyBufferFilled >= size && now - this.latencyLastUpdate > 2000) {
          this.latencyLastUpdate = now;
          queueMicrotask(() => this.runLatencyCorrelation());
        }
      };

      this.latencyMeasurerNodes = [merger, proc, silent];
    } catch {
      // If the measurer fails to install, mix-minus still runs at the
      // seeded delay; cancellation is just less precise.
    }
  }

  private runLatencyCorrelation() {
    const ctx = this.audioContext;
    const ref = this.latencyRefBuffer;
    const cap = this.latencyCapBuffer;
    const delayNode = this.mixMinusDelay;
    if (!ctx || !ref || !cap || !delayNode) return;
    const size = ref.length;
    const sr = ctx.sampleRate;
    const write = this.latencyBufferWrite;

    // Linearize the ring buffers so array indexing matches time order.
    const lin = (src: Float32Array) => {
      const out = new Float32Array(size);
      const tailLen = size - write;
      out.set(src.subarray(write), 0);
      out.set(src.subarray(0, write), tailLen);
      return out;
    };
    const refLin = lin(ref);
    const capLin = lin(cap);

    // Gate on reference energy — correlating silence produces random peaks.
    const gateWin = Math.min(size, Math.round(0.1 * sr));
    let rmsSq = 0;
    for (let i = size - gateWin; i < size; i++) rmsSq += refLin[i] * refLin[i];
    const rms = Math.sqrt(rmsSq / gateWin);
    if (rms < 0.005) return;

    // 100ms correlation window against lags from 0 to 300ms. Capture is
    // always delayed vs reference, so we only search in the positive-lag
    // direction.
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
    // correlation — otherwise we're fitting to noise and would jitter the
    // delay for no gain.
    const meanAbs = samples > 0 ? sumAbsCorr / samples : 0;
    if (bestCorr < meanAbs * 4) return;

    const measuredSec = bestLag / sr;
    try {
      delayNode.delayTime.cancelScheduledValues(ctx.currentTime);
      // Smooth ramp so the delay change doesn't introduce an audible pitch
      // wobble in whatever voice-mix content is currently being subtracted.
      delayNode.delayTime.setTargetAtTime(measuredSec, ctx.currentTime, 0.25);
    } catch {}
  }

  private tearDownMixMinus() {
    for (const n of this.mixMinusNodes) { try { n.disconnect(); } catch {} }
    this.mixMinusNodes = [];
    for (const n of this.latencyMeasurerNodes) {
      try { (n as ScriptProcessorNode).onaudioprocess = null as any; } catch {}
      try { n.disconnect(); } catch {}
    }
    this.latencyMeasurerNodes = [];
    this.mixMinusDelay = null;
    this.latencyRefBuffer = null;
    this.latencyCapBuffer = null;
    this.latencyBufferWrite = 0;
    this.latencyBufferFilled = 0;
    this.mixMinusStream?.getTracks().forEach((t) => t.stop());
    this.mixMinusStream = null;
  }

  private buildMicGraph(stream: MediaStream): MediaStreamTrack {
    if (!this.audioContext) throw new Error('AudioContext not initialized');
    this.micGainNode?.disconnect();
    this.vadGateNode?.disconnect();
    this.micDestination?.disconnect();
    this.eqNodes.forEach((n) => n.disconnect());
    this.eqNodes = [];

    const source = this.audioContext.createMediaStreamSource(stream);
    this.micGainNode = this.audioContext.createGain();
    this.micGainNode.gain.value = this.micGain;
    this.vadGateNode = this.audioContext.createGain();
    // Start open; startLevelMonitoring / PTT listeners will close it as needed.
    this.vadGateNode.gain.value = 1;
    this.micDestination = this.audioContext.createMediaStreamDestination();

    // Always build the EQ chain — keeps wiring stable across enable/disable.
    // When disabled, all band gains are zeroed so the biquads are transparent.
    for (let i = 0; i < EQ_FREQS.length; i++) {
      const filter = this.audioContext.createBiquadFilter();
      filter.type = EQ_TYPES[i];
      filter.frequency.value = EQ_FREQS[i];
      filter.Q.value = this.eqBands[i].q;
      filter.gain.value = this.eqEnabled ? this.eqBands[i].gain : 0;
      this.eqNodes.push(filter);
    }

    let prev: AudioNode = source;
    for (const filter of this.eqNodes) {
      prev.connect(filter);
      prev = filter;
    }
    prev.connect(this.micGainNode);
    this.micGainNode.connect(this.vadGateNode);
    this.vadGateNode.connect(this.micDestination);

    return this.micDestination.stream.getAudioTracks()[0];
  }

  private updateVadGate() {
    if (!this.vadGateNode) return;
    let open: boolean;
    if (this.pttEnabled) {
      open = this.pttHeld;
    } else if (this.vadMode === 'off') {
      open = true;
    } else if (this.vadMode === 'manual') {
      open = this.lastLocalRms > this.vadThreshold;
    } else {
      // Auto VAD with:
      //  - conservative noise-floor tracking (only adapts when clearly quiet,
      //    rises slowly, falls quickly — so speech tails never poison it)
      //  - hysteresis: open threshold above close threshold so the gate
      //    doesn't chatter around the boundary
      //  - hangover: once open, stay open ~400ms after RMS drops so we don't
      //    cut between syllables
      const rms = this.lastLocalRms;
      const now = performance.now();

      const quietCap = this.vadNoiseFloor + 4; // only sample when clearly not speech
      if (rms < quietCap) {
        // Asymmetric smoothing: rise slowly (α=0.02), fall fast (α=0.25).
        const alpha = rms > this.vadNoiseFloor ? 0.02 : 0.25;
        this.vadNoiseFloor = this.vadNoiseFloor * (1 - alpha) + rms * alpha;
      }
      this.vadNoiseFloor = Math.max(0.5, Math.min(this.vadNoiseFloor, 20));

      const openThresh = Math.min(Math.max(this.vadNoiseFloor + 6, 5), 40);
      const closeThresh = openThresh * 0.6;

      const wasHeld = now < this.vadHangoverUntil;
      if (rms > openThresh) {
        this.vadHangoverUntil = now + 400;
        open = true;
      } else if (rms > closeThresh && wasHeld) {
        open = true;
      } else {
        open = wasHeld;
      }
    }
    // Short ramp avoids audible clicks on gate toggle. Web Audio ignores
    // setTargetAtTime timing on a disconnected node, so wrap in a try just in
    // case the graph was torn down mid-tick.
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

        if (username === this.localUsername) {
          // Scale to 0-100 to match the VAD threshold UI scale
          this.lastLocalRms = (rms / 128) * 100;
          this.updateVadGate();
        }

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
    // Run it through a mix-minus graph that subtracts our own received peer
    // voices from the loopback so viewers don't hear themselves in the
    // screen-share audio. See `voiceMixDest` for the tap point.
    const audioTrack = this.screenStream.getAudioTracks()[0];
    if (audioTrack) {
      const outgoingTrack = this.buildMixMinusTrack(audioTrack) ?? audioTrack;
      this.screenAudioProducer = await this.sendTransport.produce({ track: outgoingTrack, appData: { source: 'screen-audio' } });
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
    this.tearDownMixMinus();

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

    // Notify React to clear all video tracks
    for (const producerId of this.videoProducerIds) {
      const username = this.producerUsernames.get(producerId);
      if (username) this.handlers.onVideoTrack(username, null);
    }
    if (this.localUsername && this.videoProducer) {
      this.handlers.onVideoTrack(this.localUsername, null);
    }
    this.videoProducerIds.clear();

    // Notify React to clear all screen tracks
    for (const producerId of this.screenProducerIds) {
      const username = this.producerUsernames.get(producerId);
      if (username) this.handlers.onScreenTrack(username, null);
    }
    if (this.localUsername && this.screenProducer) {
      this.handlers.onScreenTrack(this.localUsername, null);
    }
    this.screenProducerIds.clear();

    // Clean up screen audio
    for (const producerId of this.screenAudioProducerIds) {
      const username = this.producerUsernames.get(producerId);
      if (username) this.handlers.onScreenAudioChange(username, false);
    }
    this.screenAudioProducerIds.clear();
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
    this.tearDownMixMinus();
    this.voiceMixDest?.disconnect();
    this.voiceMixDest = null;
    this.compressorNode?.disconnect();
    this.compressorNode = null;
    this.makeupGainNode?.disconnect();
    this.makeupGainNode = null;
    this.masterGainNode?.disconnect();
    this.masterGainNode = null;
    this.rawMicStream?.getTracks().forEach((t) => t.stop());
    this.rawMicStream = null;
    this.eqNodes.forEach((n) => n.disconnect());
    this.eqNodes = [];
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
    // Release the old mic hardware before grabbing the new one
    this.rawMicStream?.getTracks().forEach((t) => t.stop());
    this.rawMicStream = await navigator.mediaDevices.getUserMedia({
      audio: { ...(deviceId && { deviceId: { exact: deviceId } }), autoGainControl: false },
    });
    const gatedTrack = this.buildMicGraph(this.rawMicStream);
    await this.audioProducer.replaceTrack({ track: gatedTrack });

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
    for (const gainNode of this.userGainNodes.values()) {
      this.routeUserGain(gainNode);
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

  setVadMode(mode: 'off' | 'auto' | 'manual') {
    this.vadMode = mode;
    this.vadNoiseFloor = 3;
    this.vadHangoverUntil = 0;
    localStorage.setItem('vadMode', mode);
    this.updateVadGate();
  }

  setVadThreshold(threshold: number) {
    this.vadThreshold = threshold;
    localStorage.setItem('vadThreshold', String(threshold));
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
