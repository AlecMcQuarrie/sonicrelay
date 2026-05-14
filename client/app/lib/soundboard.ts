import { buildUploadUrl } from "~/lib/protocol";

export type Soundboard = {
  __id: string;
  name: string;
  emoji: string;
  fileUrl: string;
  trimStart: number;
  trimEnd: number;
  duration: number;
  uploadedBy: string;
  uploadedAt: number;
  order: number;
};

export type SoundboardPeerSetting = {
  volume: number;
  muted: boolean;
};

// One shared AudioContext for the whole app's soundboard playback.
// AudioBufferSourceNode is single-use, so each playSound() creates a
// fresh source — naturally polyphonic, no manual pause/restart juggling.
let audioContext: AudioContext | null = null;
function ctx(): AudioContext {
  if (!audioContext) audioContext = new AudioContext();
  return audioContext;
}

export function getSoundboardAudioContext(): AudioContext {
  return ctx();
}

// Gain chain: each source → per-user gain → master gain → destination.
// Mirrors voice.ts's userGainNodes + masterGainNode so per-peer mute and
// global volume sliders apply live with smooth ramps.
let masterGainNode: GainNode | null = null;
let masterGainValue = 1;
const peerGainNodes = new Map<string, GainNode>();
const peerSettings = new Map<string, SoundboardPeerSetting>();

const RAMP_SECONDS = 0.05;

function ensureMaster(c: AudioContext): GainNode {
  if (!masterGainNode) {
    masterGainNode = c.createGain();
    masterGainNode.gain.value = masterGainValue;
    masterGainNode.connect(c.destination);
  }
  return masterGainNode;
}

function applyPeerGain(username: string) {
  const node = peerGainNodes.get(username);
  if (!node || !audioContext) return;
  const setting = peerSettings.get(username) ?? { volume: 1, muted: false };
  const target = setting.muted ? 0 : setting.volume;
  try {
    node.gain.cancelScheduledValues(audioContext.currentTime);
    node.gain.linearRampToValueAtTime(target, audioContext.currentTime + RAMP_SECONDS);
  } catch {}
}

function ensurePeerGain(c: AudioContext, username: string): GainNode {
  let node = peerGainNodes.get(username);
  if (!node) {
    node = c.createGain();
    const setting = peerSettings.get(username) ?? { volume: 1, muted: false };
    node.gain.value = setting.muted ? 0 : setting.volume;
    node.connect(ensureMaster(c));
    peerGainNodes.set(username, node);
  }
  return node;
}

export function setSoundboardMasterGain(gain: number) {
  masterGainValue = gain;
  if (masterGainNode && audioContext) {
    try {
      masterGainNode.gain.cancelScheduledValues(audioContext.currentTime);
      masterGainNode.gain.linearRampToValueAtTime(gain, audioContext.currentTime + RAMP_SECONDS);
    } catch {}
  }
}

export function setSoundboardPeerVolume(username: string, volume: number) {
  const prev = peerSettings.get(username) ?? { volume: 1, muted: false };
  peerSettings.set(username, { ...prev, volume });
  applyPeerGain(username);
}

export function setSoundboardPeerMuted(username: string, muted: boolean) {
  const prev = peerSettings.get(username) ?? { volume: 1, muted: false };
  peerSettings.set(username, { ...prev, muted });
  applyPeerGain(username);
}

export function hydrateSoundboardPeerSettings(settings: Record<string, SoundboardPeerSetting>) {
  for (const [username, s] of Object.entries(settings)) {
    peerSettings.set(username, s);
    applyPeerGain(username);
  }
}

const bufferCache = new Map<string, Promise<AudioBuffer>>();

function fetchBuffer(sound: Soundboard, serverIP: string, uploadToken: string): Promise<AudioBuffer> {
  let p = bufferCache.get(sound.__id);
  if (!p) {
    p = (async () => {
      const url = buildUploadUrl(sound.fileUrl, serverIP, uploadToken);
      const res = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      return ctx().decodeAudioData(arrayBuffer);
    })().catch((err) => {
      bufferCache.delete(sound.__id);
      throw err;
    });
    bufferCache.set(sound.__id, p);
  }
  return p;
}

export async function playSound(
  sound: Soundboard,
  serverIP: string,
  uploadToken: string,
  triggeringUser: string,
) {
  try {
    const c = ctx();
    if (c.state === "suspended") await c.resume();
    const buffer = await fetchBuffer(sound, serverIP, uploadToken);
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.connect(ensurePeerGain(c, triggeringUser));
    const start = Math.max(0, Math.min(sound.trimStart, buffer.duration));
    const end = Math.max(start, Math.min(sound.trimEnd, buffer.duration));
    source.start(0, start, end - start);
  } catch {
    // Swallow — a failed sound shouldn't break the rest of the app.
  }
}

export function clearSoundCache(soundId: string) {
  bufferCache.delete(soundId);
}
