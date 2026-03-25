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

  constructor(ws: WebSocket, handlers: VoiceHandlers) {
    this.ws = ws;
    this.handlers = handlers;

    // Listen for voice notifications
    this.notificationHandler = (event: MessageEvent) => {
      const msg = JSON.parse(event.data);
      if (msg.type !== 'voice-notification') return;

      switch (msg.action) {
        case 'new-producer':
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

  async join(channelId: string) {
    this.channelId = channelId;
    this.device = new Device();

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
    for (const { producerId } of joinResult.existingProducers) {
      await this.consumeProducer(producerId);
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

    // Play the received audio
    const audio = new Audio();
    audio.srcObject = new MediaStream([consumer.track]);
    audio.play();
    this.audioElements.set(producerId, audio);
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
  }

  toggleMute(): boolean {
    if (!this.audioProducer) return false;
    if (this.audioProducer.paused) this.audioProducer.resume();
    else this.audioProducer.pause();
    return this.audioProducer.paused;
  }

  async leave() {
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
  }

  destroy() {
    this.ws.removeEventListener('message', this.notificationHandler);
  }
}
