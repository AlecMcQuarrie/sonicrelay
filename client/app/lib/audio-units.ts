// Slider range used by the voice UI for volume / gain controls. The
// VoiceClient itself works in linear amplitude; these helpers translate
// at the UI boundary so storage and the audio graph stay unchanged.
export const DB_MIN = -12;
export const DB_MAX = 12;
export const DB_STEP = 0.5;

const AMP_MIN = Math.pow(10, DB_MIN / 20);
const AMP_MAX = Math.pow(10, DB_MAX / 20);

export function dbToAmp(db: number): number {
  return Math.pow(10, db / 20);
}

export function ampToDb(amp: number): number {
  if (amp <= 0) return DB_MIN;
  const db = 20 * Math.log10(amp);
  if (db < DB_MIN) return DB_MIN;
  if (db > DB_MAX) return DB_MAX;
  return db;
}

export function formatDb(db: number): string {
  const rounded = Math.round(db * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)} dB`;
}

// Used when reading legacy values that may have been saved at 0 (full
// attenuate from the old percentage slider) or above the new ceiling.
export function clampAmpToDbRange(amp: number): number {
  if (amp < AMP_MIN) return AMP_MIN;
  if (amp > AMP_MAX) return AMP_MAX;
  return amp;
}
