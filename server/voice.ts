import * as mediasoup from 'mediasoup';
import type { types } from 'mediasoup';

// Codec configuration
const mediaCodecs: types.RouterRtpCodecCapability[] = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
];

// Types
type Peer = {
  sendTransport: types.WebRtcTransport | null;
  recvTransport: types.WebRtcTransport | null;
  producers: Map<string, types.Producer>;
  consumers: Map<string, types.Consumer>;
};

type Room = {
  router: types.Router;
  peers: Map<string, Peer>;
};

// State
let worker: types.Worker;
const rooms = new Map<string, Room>();

// Initialize mediasoup worker
export async function init() {
  worker = await mediasoup.createWorker({
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
  });
  console.log('mediasoup worker created');
}

// Get or create a voice room for a channel
async function getOrCreateRoom(channelId: string): Promise<Room> {
  let room = rooms.get(channelId);
  if (room) return room;

  const router = await worker.createRouter({ mediaCodecs });
  room = { router, peers: new Map() };
  rooms.set(channelId, room);
  return room;
}

// Join a voice channel
export async function join(channelId: string, username: string) {
  const room = await getOrCreateRoom(channelId);

  room.peers.set(username, {
    sendTransport: null,
    recvTransport: null,
    producers: new Map(),
    consumers: new Map(),
  });

  // Collect existing producers from other peers
  const existingProducers: { producerId: string; kind: string; username: string }[] = [];
  for (const [peerUsername, peer] of room.peers) {
    if (peerUsername === username) continue;
    for (const [id, producer] of peer.producers) {
      existingProducers.push({ producerId: id, kind: producer.kind, username: peerUsername });
    }
  }

  return {
    rtpCapabilities: room.router.rtpCapabilities,
    existingProducers,
  };
}

// Create a WebRTC transport for a peer
export async function createTransport(channelId: string, username: string, direction: 'send' | 'recv') {
  const room = rooms.get(channelId);
  const peer = room?.peers.get(username);
  if (!room || !peer) throw new Error('Room or peer not found');

  const announcedIp = process.env.ANNOUNCED_IP || '127.0.0.1';
  const transport = await room.router.createWebRtcTransport({
    listenInfos: [
      { protocol: 'udp', ip: '0.0.0.0', announcedAddress: announcedIp },
      { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: announcedIp },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });

  if (direction === 'send') peer.sendTransport = transport;
  else peer.recvTransport = transport;

  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
}

// Connect a transport (ICE/DTLS handshake)
export async function connectTransport(
  channelId: string, username: string, transportId: string, dtlsParameters: types.DtlsParameters,
) {
  const peer = rooms.get(channelId)?.peers.get(username);
  if (!peer) throw new Error('Peer not found');

  const transport = [peer.sendTransport, peer.recvTransport].find((t) => t?.id === transportId);
  if (!transport) throw new Error('Transport not found');

  await transport.connect({ dtlsParameters });
}

// Start producing media (client sending audio/video)
export async function produce(
  channelId: string, username: string, kind: types.MediaKind, rtpParameters: types.RtpParameters,
) {
  const peer = rooms.get(channelId)?.peers.get(username);
  if (!peer?.sendTransport) throw new Error('Send transport not found');

  const producer = await peer.sendTransport.produce({ kind, rtpParameters });
  peer.producers.set(producer.id, producer);

  return { producerId: producer.id };
}

// Consume a producer (client receiving audio/video from another peer)
export async function consume(
  channelId: string, username: string, producerId: string, rtpCapabilities: types.RtpCapabilities,
) {
  const room = rooms.get(channelId);
  const peer = room?.peers.get(username);
  if (!room || !peer?.recvTransport) throw new Error('Room or recv transport not found');

  if (!room.router.canConsume({ producerId, rtpCapabilities })) {
    throw new Error('Cannot consume');
  }

  const consumer = await peer.recvTransport.consume({
    producerId,
    rtpCapabilities,
    paused: false,
  });

  peer.consumers.set(consumer.id, consumer);

  return {
    consumerId: consumer.id,
    producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
  };
}

// Close a single producer (e.g. when a user turns off their camera)
export function closeProducer(channelId: string, username: string, producerId: string) {
  const peer = rooms.get(channelId)?.peers.get(username);
  if (!peer) throw new Error('Peer not found');

  const producer = peer.producers.get(producerId);
  if (!producer) throw new Error('Producer not found');

  producer.close();
  peer.producers.delete(producerId);
}

// Leave a voice channel - returns closed producer IDs for notification
export function leave(channelId: string, username: string): string[] {
  const room = rooms.get(channelId);
  const peer = room?.peers.get(username);
  if (!room || !peer) return [];

  const closedProducerIds = [...peer.producers.keys()];

  peer.sendTransport?.close();
  peer.recvTransport?.close();
  room.peers.delete(username);

  // Clean up empty rooms
  if (room.peers.size === 0) {
    room.router.close();
    rooms.delete(channelId);
  }

  return closedProducerIds;
}
