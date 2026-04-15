import { useEffect } from "react";

// Preset theme metadata. The actual color values live in app.css as
// `.theme-<id>` blocks — these tuples are just previews for the swatch
// grid in the theme picker. Tuple order: [background, card, foreground,
// primary, destructive].
export type ThemePreset = {
  id: string;
  name: string;
  preview: [string, string, string, string, string];
};

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'system',           name: 'System',          preview: ['#0a0a0a', '#ffffff', '#737373', '#e5e5e5', '#e7000a'] },
  { id: 'light',            name: 'Light',           preview: ['#ffffff', '#f5f5f5', '#0a0a0a', '#171717', '#e7000a'] },
  { id: 'dark',             name: 'Dark',            preview: ['#0a0a0a', '#171717', '#fafafa', '#e5e5e5', '#ff6467'] },
  { id: 'dracula',          name: 'Dracula',         preview: ['#282a36', '#343746', '#f8f8f2', '#bd93f9', '#ff5555'] },
  { id: 'nord',             name: 'Nord',            preview: ['#2e3440', '#3b4252', '#d8dee9', '#88c0d0', '#bf616a'] },
  { id: 'monokai',          name: 'Monokai',         preview: ['#272822', '#34352e', '#f8f8f2', '#a6e22e', '#f92672'] },
  { id: 'gruvbox',          name: 'Gruvbox',         preview: ['#282828', '#3c3836', '#ebdbb2', '#fe8019', '#fb4934'] },
  { id: 'solarized-light',  name: 'Solarized Light', preview: ['#fdf6e3', '#eee8d5', '#586e75', '#268bd2', '#dc322f'] },
];

export const CUSTOM_THEME_ID = 'custom';

export type CustomColors = {
  background: string;
  card: string;
  foreground: string;
  primary: string;
  destructive: string;
};

// Seeded from the Dark theme so a fresh custom palette looks reasonable.
export const DEFAULT_CUSTOM_COLORS: CustomColors = {
  background: '#0a0a0a',
  card: '#171717',
  foreground: '#fafafa',
  primary: '#e5e5e5',
  destructive: '#ff6467',
};

// Map 5 user-chosen colors onto the full shadcn variable set.
// Derivations follow the rules documented in the plan; muted-foreground
// is a 50/50 mix of foreground and background for a dimmed text tone.
export function customColorsToVars(c: CustomColors): Record<string, string> {
  const mutedFg = hexMix(c.foreground, c.background, 0.5);
  return {
    '--background': c.background,
    '--foreground': c.foreground,
    '--card': c.card,
    '--card-foreground': c.foreground,
    '--popover': c.card,
    '--popover-foreground': c.foreground,
    '--primary': c.primary,
    '--primary-foreground': c.background,
    '--secondary': c.card,
    '--secondary-foreground': c.foreground,
    '--muted': c.card,
    '--muted-foreground': mutedFg,
    '--accent': c.card,
    '--accent-foreground': c.foreground,
    '--destructive': c.destructive,
    '--border': c.card,
    '--input': c.card,
    '--ring': c.primary,
    '--sidebar': c.background,
    '--sidebar-foreground': c.foreground,
    '--sidebar-primary': c.primary,
    '--sidebar-primary-foreground': c.background,
    '--sidebar-accent': c.card,
    '--sidebar-accent-foreground': c.foreground,
    '--sidebar-border': c.card,
    '--sidebar-ring': c.primary,
  };
}

// Linear interpolation between two #RRGGBB hex strings. Returns a hex string.
export function hexMix(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const r = Math.round(pa.r * (1 - t) + pb.r * t);
  const g = Math.round(pa.g * (1 - t) + pb.g * t);
  const bl = Math.round(pa.b * (1 - t) + pb.b * t);
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
}

const CUSTOM_VAR_KEYS = Object.keys(customColorsToVars(DEFAULT_CUSTOM_COLORS));

// Apply custom colors as inline CSS variables on <html>. When `enabled`
// flips off, strip them so the underlying theme class takes over cleanly.
export function useCustomThemeVars(colors: CustomColors, enabled: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    if (!enabled) {
      for (const key of CUSTOM_VAR_KEYS) root.style.removeProperty(key);
      return;
    }
    const vars = customColorsToVars(colors);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    return () => {
      for (const key of CUSTOM_VAR_KEYS) root.style.removeProperty(key);
    };
  }, [enabled, colors]);
}

export function loadCustomColors(): CustomColors {
  if (typeof window === 'undefined') return DEFAULT_CUSTOM_COLORS;
  const raw = localStorage.getItem('customThemeColors');
  if (!raw) return DEFAULT_CUSTOM_COLORS;
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CUSTOM_COLORS, ...parsed };
  } catch {
    return DEFAULT_CUSTOM_COLORS;
  }
}

export function saveCustomColors(colors: CustomColors) {
  localStorage.setItem('customThemeColors', JSON.stringify(colors));
}
