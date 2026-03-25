import { Device } from 'mediasoup-client';
import type { types } from 'mediasoup-client';

// Send a voice request over WebSocket and await the matching response
function request(ws: WebSocket, action: string, data: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const handler = (event: MessageEvent) => {
      const msg = JSON.parse(event.data);
      if (msg.requestId === requestId) {
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
};

export class VoiceClient {
  private device: Device | null = null;
  private sendTransport: types.Transport | null = null;
  private recvTransport: types.Transport | null = null;
  private audioProducer: types.Producer | null = null;
  private consumers = new Map<string, types.Consumer>();
  private audioElements = new Map<string, HTMLAudioElement>();
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

    this.sendTransport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
      request(this.ws, 'produce', {
        channelId, kind, rtpParameters,
      }).then(({ producerId }) => callback({ id: producerId })).catch(errback);
    });

    // Produce audio from microphone
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    for (const { producerId, username: producerUsername } of joinResult.existingProducers) {
      if (producerUsername) this.producerUsernames.set(producerId, producerUsername);
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

    // Play the received audio
    const audio = new Audio();
    audio.srcObject = new MediaStream([consumer.track]);
    audio.play();
    this.audioElements.set(producerId, audio);

    // Monitor remote audio levels
    const remoteUsername = this.producerUsernames.get(producerId);
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
    const audio = this.audioElements.get(producerId);
    if (audio) {
      audio.srcObject = null;
      this.audioElements.delete(producerId);
    }
    const username = this.producerUsernames.get(producerId);
    if (username) {
      this.analysers.delete(username);
      this.speakingState.delete(username);
      this.handlers.onSpeakingChange(username, false);
      this.producerUsernames.delete(producerId);
    }
  }

  private startLevelMonitoring() {
    const SPEAKING_THRESHOLD = 15; // audio level 0-255
    const dataArray = new Uint8Array(128);

    this.levelCheckInterval = setInterval(() => {
      for (const [username, analyser] of this.analysers) {
        analyser.getByteFrequencyData(dataArray);
        // Average the frequency data to get an overall level
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const average = sum / dataArray.length;

        const isSpeaking = average > SPEAKING_THRESHOLD;
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

  async leave() {
    this.stopLevelMonitoring();
    if (this.channelId) {
      await request(this.ws, 'leave', { channelId: this.channelId });
    }
    this.audioProducer?.close();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.consumers.forEach((c) => c.close());
    this.consumers.clear();
    this.audioElements.forEach((a) => { a.srcObject = null; });
    this.audioElements.clear();
    this.audioProducer = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.channelId = null;
    this.localUsername = null;
  }

  destroy() {
    this.ws.removeEventListener('message', this.notificationHandler);
  }
}
