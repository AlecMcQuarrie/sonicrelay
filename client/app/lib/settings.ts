import type { VoiceClient } from "~/lib/voice";
import {
  DEFAULT_CUSTOM_COLORS,
  loadCustomColors,
  saveCustomColors,
  type CustomColors,
} from "~/lib/themes";

// Cross-device user preferences. Mirrored to localStorage as a fast-paint
// cache; the server is the source of truth once /me/settings has resolved.
// Device-specific fields (mic/camera/output device IDs, mute/deafen session
// state) are intentionally omitted — they don't transfer across machines.
export type EqBand = { gain: number; q: number };

// Fixed center frequencies and node types for the 5-band mic EQ. Not
// user-configurable — keeping these constant simplifies the UI and matches
// the node layout the VoiceClient builds.
export const EQ_BAND_FREQS = [80, 250, 1000, 4000, 10000] as const;
export const EQ_BAND_TYPES: BiquadFilterType[] = ['lowshelf', 'peaking', 'peaking', 'peaking', 'highshelf'];
export const EQ_BAND_LABELS = ['80 Hz', '250 Hz', '1 kHz', '4 kHz', '10 kHz'] as const;
export const DEFAULT_EQ_BANDS: EqBand[] = EQ_BAND_FREQS.map(() => ({ gain: 0, q: 1 }));

export type UserSettings = {
  micGain: number;
  speakerGain: number;
  // "manual threshold" VAD was dropped when Silero auto-VAD landed.
  vadMode: 'off' | 'auto';
  pttEnabled: boolean;
  pttKey: string;
  normalizeVoices: boolean;
  rnnoiseEnabled: boolean;
  micEqEnabled: boolean;
  micEqBands: EqBand[];
  theme: string;
  customThemeColors: CustomColors;
};

export const DEFAULT_SETTINGS: UserSettings = {
  micGain: 1,
  speakerGain: 1,
  vadMode: 'off',
  pttEnabled: false,
  pttKey: '',
  normalizeVoices: true,
  rnnoiseEnabled: true,
  micEqEnabled: false,
  micEqBands: DEFAULT_EQ_BANDS,
  theme: 'system',
  customThemeColors: DEFAULT_CUSTOM_COLORS,
};

// Read the individual localStorage keys VoiceClient already writes so the
// UI can paint with last-known values before the server fetch resolves.
export function loadCachedSettings(): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  const storedMode = localStorage.getItem('vadMode');
  // Migrate removed 'manual' → 'auto'; Silero's auto mode supersedes it.
  const vadMode: 'off' | 'auto' =
    storedMode === 'off' ? 'off'
    : storedMode === 'auto' || storedMode === 'manual' ? 'auto'
    : DEFAULT_SETTINGS.vadMode;
  // Treat absent key as default so existing users whose first visit predates
  // the default flip (and never touched the toggle) get the new default too.
  const storedNormalize = localStorage.getItem('normalizeVoices');
  const normalizeVoices = storedNormalize === null
    ? DEFAULT_SETTINGS.normalizeVoices
    : storedNormalize === 'true';
  const storedRnnoise = localStorage.getItem('rnnoiseEnabled');
  const rnnoiseEnabled = storedRnnoise === null
    ? DEFAULT_SETTINGS.rnnoiseEnabled
    : storedRnnoise === 'true';
  const storedEqEnabled = localStorage.getItem('micEqEnabled');
  const micEqEnabled = storedEqEnabled === null
    ? DEFAULT_SETTINGS.micEqEnabled
    : storedEqEnabled === 'true';
  let micEqBands = DEFAULT_EQ_BANDS;
  const storedBands = localStorage.getItem('micEqBands');
  if (storedBands) {
    try {
      const parsed = JSON.parse(storedBands);
      if (Array.isArray(parsed) && parsed.length === 5 && parsed.every(b => typeof b?.gain === 'number' && typeof b?.q === 'number')) {
        micEqBands = parsed.map((b: any) => ({ gain: b.gain, q: b.q }));
      }
    } catch {}
  }
  return {
    micGain: parseFloat(localStorage.getItem('micGain') ?? String(DEFAULT_SETTINGS.micGain)),
    speakerGain: parseFloat(localStorage.getItem('speakerGain') ?? String(DEFAULT_SETTINGS.speakerGain)),
    vadMode,
    pttEnabled: localStorage.getItem('pttEnabled') === 'true',
    pttKey: localStorage.getItem('pttKey') ?? DEFAULT_SETTINGS.pttKey,
    normalizeVoices,
    rnnoiseEnabled,
    micEqEnabled,
    micEqBands,
    theme: localStorage.getItem('theme') ?? DEFAULT_SETTINGS.theme,
    customThemeColors: loadCustomColors(),
  };
}

// Mirror a partial update to the same individual keys VoiceClient reads
// from on next mount. Keeps the fast-path cache in sync.
export function cacheSettings(partial: Partial<UserSettings>) {
  if (typeof window === 'undefined') return;
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) continue;
    if (key === 'customThemeColors') {
      saveCustomColors(value as CustomColors);
    } else if (key === 'micEqBands') {
      localStorage.setItem(key, JSON.stringify(value));
    } else {
      localStorage.setItem(key, String(value));
    }
  }
}

// Push runtime-relevant settings into the VoiceClient. Called once
// immediately after construction with cached values, and again after the
// server fetch resolves with the authoritative values.
export function applyVoiceSettings(voice: VoiceClient | null, s: UserSettings) {
  if (!voice) return;
  voice.setMicGain(s.micGain);
  voice.setSpeakerGain(s.speakerGain);
  voice.setVadMode(s.vadMode);
  voice.setPttEnabled(s.pttEnabled);
  voice.setPttKey(s.pttKey);
  voice.setNormalizeVoices(s.normalizeVoices);
  voice.setRnnoiseEnabled(s.rnnoiseEnabled);
  voice.setMicEqEnabled(s.micEqEnabled);
  s.micEqBands.forEach((b, i) => voice.setEqBand(i, b.gain, b.q));
}
