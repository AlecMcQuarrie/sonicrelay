import { Device } from 'mediasoup-client';
import type { types } from 'mediasoup-client';

// Send a voice request over WebSocket and await the matching response
function request(ws: WebSocket, action: string, data: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket is not open'));
      return;
    }
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`Request "${action}" timed out`));
    }, 10000);
    const handler = (event: MessageEvent) => {
      const msg = JSON.parse(event.data);
      if (msg.requestId === requestId) {
        clearTimeout(timeout);
        ws.removeEventListener('message', handler);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ requestId, type: 'voice', action, ...data }));
  });
}

type VoiceHandlers = {
  onPeerJoined: (channelId: string, username: string) => void;
  onPeerLeft: (channelId: string, username: string) => void;
  onSpeakingChange: (username: string, isSpeaking: boolean) => void;
  onVideoTrack: (username: string, track: MediaStreamTrack | null) => void;
  onScreenTrack: (username: string, track: MediaStreamTrack | null) => void;
  onScreenAudioChange: (username: string, available: boolean) => void;
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
  private audioElements = new Map<string, HTMLAudioElement>();
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
  private speakingState = new Map<string, boolean>(); // username -> isSpeaking
  private producerUsernames = new Map<string, string>(); // producerId -> username
  private levelCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(ws: WebSocket, handlers: VoiceHandlers) {
    this.ws = ws;
    this.handlers = handlers;

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
          break;
        case 'peer-left':
          this.handlers.onPeerLeft(msg.channelId, msg.username);
          break;
      }
    };
    ws.addEventListener('message', this.notificationHandler);
  }

  async join(channelId: string, username?: string) {
    this.channelId = channelId;
    if (username) this.localUsername = username;
    this.device = new Device();
    this.audioContext = new AudioContext();
    // Browsers may start AudioContext in suspended state — resume it
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
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

    // Produce audio from microphone
    const preferredAudio = localStorage.getItem("preferredAudioDevice");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: preferredAudio ? { deviceId: { exact: preferredAudio } } : true,
    });
    this.audioProducer = await this.sendTransport.produce({ track: stream.getAudioTracks()[0] });

    // Monitor local mic audio levels
    if (this.localUsername && this.audioContext) {
      const source = this.audioContext.createMediaStreamSource(stream);
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
      const audio = new Audio();
      audio.srcObject = new MediaStream([consumer.track]);
      audio.play();
      this.screenAudioElements.set(remoteUsername, audio);
      this.handlers.onScreenAudioChange(remoteUsername, true);
      return;
    }

    // Play the received mic audio
    const audio = new Audio();
    audio.srcObject = new MediaStream([consumer.track]);
    audio.play();
    this.audioElements.set(producerId, audio);

    // Monitor remote audio levels
    if (remoteUsername && this.audioContext) {
      const source = this.audioContext.createMediaStreamSource(new MediaStream([consumer.track]));
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      this.analysers.set(remoteUsername, analyser);
    }
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
      const audio = this.audioElements.get(producerId);
      if (audio) {
        audio.srcObject = null;
        this.audioElements.delete(producerId);
      }
      if (username) {
        this.analysers.delete(username);
        this.speakingState.delete(username);
        this.handlers.onSpeakingChange(username, false);
      }
    }

    if (username) this.producerUsernames.delete(producerId);
    this.producerSources.delete(producerId);
  }

  private startLevelMonitoring() {
    const SPEAKING_THRESHOLD = 10; // RMS deviation from silence (0-128 scale)
    const bufferLength = 256; // matches fftSize on our analysers
    const dataArray = new Uint8Array(bufferLength);

    this.levelCheckInterval = setInterval(() => {
      for (const [username, analyser] of this.analysers) {
        analyser.getByteTimeDomainData(dataArray);
        // Calculate RMS deviation from silence (128 = silence center)
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const deviation = dataArray[i] - 128;
          sumSquares += deviation * deviation;
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);

        const isSpeaking = rms > SPEAKING_THRESHOLD;
        const wasSpeaking = this.speakingState.get(username) ?? false;
        if (isSpeaking !== wasSpeaking) {
          this.speakingState.set(username, isSpeaking);
          this.handlers.onSpeakingChange(username, isSpeaking);
        }
      }
    }, 100);
  }

  private stopLevelMonitoring() {
    if (this.levelCheckInterval) {
      clearInterval(this.levelCheckInterval);
      this.levelCheckInterval = null;
    }
    // Notify all as not speaking
    for (const [username] of this.speakingState) {
      this.handlers.onSpeakingChange(username, false);
    }
    this.analysers.clear();
    this.speakingState.clear();
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

  async startScreenShare() {
    if (!this.sendTransport || !this.channelId || this.screenProducer) return;
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const screenTrack = this.screenStream.getVideoTracks()[0];

    // Browser "Stop sharing" button closes the track — handle it
    screenTrack.onended = () => { this.stopScreenShare(); };

    this.screenProducer = await this.sendTransport.produce({ track: screenTrack, appData: { source: 'screen' } });

    // Produce screen audio if the user shared a tab/window with audio
    const audioTrack = this.screenStream.getAudioTracks()[0];
    if (audioTrack) {
      this.screenAudioProducer = await this.sendTransport.produce({ track: audioTrack, appData: { source: 'screen-audio' } });
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

  async leave() {
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
    if (this.channelId) {
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
    this.audioElements.forEach((a) => { a.srcObject = null; });
    this.audioElements.clear();
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

  setScreenAudioVolume(username: string, volume: number) {
    const audio = this.screenAudioElements.get(username);
    if (audio) audio.volume = Math.max(0, Math.min(1, volume));
  }

  setScreenAudioMuted(username: string, muted: boolean) {
    const audio = this.screenAudioElements.get(username);
    if (audio) audio.muted = muted;
  }

  destroy() {
    this.ws.removeEventListener('message', this.notificationHandler);
  }
}
