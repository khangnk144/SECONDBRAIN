/** UI preferences as stored in the global settings file (settings.ui). */
export type Language = 'vi' | 'en';
export type ThemePreference = 'dark' | 'light' | 'system';
export type Palette = 'dau-tam' | 'hoa-dao' | 'oai-huong';
export type FontSize = 14 | 16 | 18;

export interface UiPrefs {
  name: string;
  language: Language;
  theme: ThemePreference;
  palette: Palette;
  fontSize: FontSize;
}

export const LANGUAGES: readonly Language[] = ['vi', 'en'];
export const THEMES: readonly ThemePreference[] = ['dark', 'light', 'system'];
export const PALETTES: readonly Palette[] = ['dau-tam', 'hoa-dao', 'oai-huong'];
export const FONT_SIZES: readonly FontSize[] = [14, 16, 18];

export const DEFAULT_UI_PREFS: UiPrefs = {
  name: 'khangnie',
  language: 'vi',
  theme: 'dark',
  palette: 'dau-tam',
  fontSize: 16,
};

function pick<T>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Validates an untrusted object field by field, falling back to defaults. */
export function normalizeUiPrefs(input: unknown): UiPrefs {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const name =
    typeof raw.name === 'string' && raw.name.trim() !== ''
      ? raw.name.trim()
      : DEFAULT_UI_PREFS.name;
  const fontSize = typeof raw.fontSize === 'string' ? Number(raw.fontSize) : raw.fontSize;
  return {
    name,
    language: pick(LANGUAGES, raw.language, DEFAULT_UI_PREFS.language),
    theme: pick(THEMES, raw.theme, DEFAULT_UI_PREFS.theme),
    palette: pick(PALETTES, raw.palette, DEFAULT_UI_PREFS.palette),
    fontSize: pick(FONT_SIZES, fontSize, DEFAULT_UI_PREFS.fontSize),
  };
}
