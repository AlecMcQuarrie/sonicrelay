import { useTheme } from "next-themes";
import { Check, Palette } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  THEME_PRESETS,
  CUSTOM_THEME_ID,
  DEFAULT_CUSTOM_COLORS,
  useCustomThemeVars,
  type CustomColors,
} from "~/lib/themes";
import type { UserSettings } from "~/lib/settings";

const CUSTOM_FIELDS: { key: keyof CustomColors; label: string }[] = [
  { key: 'background',  label: 'Background' },
  { key: 'card',        label: 'Surface' },
  { key: 'foreground',  label: 'Text' },
  { key: 'primary',     label: 'Primary' },
  { key: 'destructive', label: 'Destructive' },
];

interface ThemePickerProps {
  settings: UserSettings;
  updateSettings: (partial: Partial<UserSettings>) => void;
}

export default function ThemePicker({ settings, updateSettings }: ThemePickerProps) {
  const { setTheme } = useTheme();
  const customColors = settings.customThemeColors;

  // Apply custom CSS variables as inline styles whenever the custom theme is active
  useCustomThemeVars(customColors, settings.theme === CUSTOM_THEME_ID);

  const selectTheme = (id: string) => {
    updateSettings({ theme: id });
    setTheme(id);
  };

  const updateCustom = (key: keyof CustomColors, value: string) => {
    updateSettings({ customThemeColors: { ...customColors, [key]: value } });
  };

  const resetCustom = () => {
    updateSettings({ customThemeColors: DEFAULT_CUSTOM_COLORS });
  };

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium">Theme</label>
      <div className="grid grid-cols-3 gap-2">
        {THEME_PRESETS.map((t) => (
          <ThemeTile
            key={t.id}
            name={t.name}
            preview={t.preview}
            active={settings.theme === t.id}
            onClick={() => selectTheme(t.id)}
          />
        ))}
        <CustomTile
          active={settings.theme === CUSTOM_THEME_ID}
          colors={customColors}
          onClick={() => selectTheme(CUSTOM_THEME_ID)}
        />
      </div>
      {settings.theme === CUSTOM_THEME_ID && (
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Custom colors</span>
            <Button variant="ghost" size="sm" onClick={resetCustom}>Reset</Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {CUSTOM_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-sm">
                <input
                  type="color"
                  value={customColors[f.key]}
                  onChange={(e) => updateCustom(f.key, e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border border-input bg-transparent"
                />
                <span className="text-muted-foreground">{f.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeTile({
  name, preview, active, onClick,
}: {
  name: string;
  preview: [string, string, string, string, string];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-center gap-1.5 rounded-md border p-2 transition-colors hover:bg-accent ${
        active ? 'ring-2 ring-primary' : ''
      }`}
    >
      <div
        className="w-full h-8 rounded overflow-hidden flex"
        style={{ backgroundColor: preview[0] }}
      >
        <div className="flex-1" style={{ backgroundColor: preview[1] }} />
        <div className="flex-1 flex items-center justify-center gap-0.5">
          <Dot color={preview[2]} />
          <Dot color={preview[3]} />
          <Dot color={preview[4]} />
        </div>
      </div>
      <span className="text-xs font-medium">{name}</span>
      {active && (
        <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
          <Check className="w-3 h-3" />
        </div>
      )}
    </button>
  );
}

function CustomTile({
  active, colors, onClick,
}: {
  active: boolean;
  colors: CustomColors;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-center gap-1.5 rounded-md border p-2 transition-colors hover:bg-accent ${
        active ? 'ring-2 ring-primary' : ''
      }`}
    >
      <div
        className="w-full h-8 rounded overflow-hidden flex items-center justify-center"
        style={{ backgroundColor: colors.background }}
      >
        <Palette className="w-4 h-4" style={{ color: colors.primary }} />
      </div>
      <span className="text-xs font-medium">Custom</span>
      {active && (
        <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
          <Check className="w-3 h-3" />
        </div>
      )}
    </button>
  );
}

function Dot({ color }: { color: string }) {
  return <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />;
}
