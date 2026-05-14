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
};

// Reuse one HTMLAudioElement per sound so the browser only fetches the
// file once per session. Re-triggering a sound mid-playback resets it.
const audioCache = new Map<string, HTMLAudioElement>();

export function playSound(sound: Soundboard, serverIP: string, uploadToken: string) {
  let audio = audioCache.get(sound.__id);
  if (!audio) {
    audio = new Audio(buildUploadUrl(sound.fileUrl, serverIP, uploadToken));
    audioCache.set(sound.__id, audio);
  }

  audio.pause();
  audio.currentTime = sound.trimStart;

  const onTimeUpdate = () => {
    if (audio!.currentTime >= sound.trimEnd) {
      audio!.pause();
      audio!.removeEventListener("timeupdate", onTimeUpdate);
    }
  };
  audio.addEventListener("timeupdate", onTimeUpdate);
  audio.play().catch(() => {});
}

export function clearSoundCache(soundId: string) {
  const audio = audioCache.get(soundId);
  if (audio) {
    audio.pause();
    audioCache.delete(soundId);
  }
}
