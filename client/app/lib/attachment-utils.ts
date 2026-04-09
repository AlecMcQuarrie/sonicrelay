export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'];
export const VIDEO_EXTS = ['.mp4', '.webm', '.ogg', '.mov'];
export const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'];

export function getExt(name: string): string {
  return name.substring(name.lastIndexOf('.')).toLowerCase();
}

export function getFilename(url: string): string {
  return url.substring(url.lastIndexOf('/') + 1);
}

export function getMimeType(name: string): string {
  const ext = getExt(name);
  const mimes: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'application/ogg', '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
  };
  return mimes[ext] || 'application/octet-stream';
}
