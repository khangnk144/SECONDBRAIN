/** UI preferences as stored in the global settings file (settings.ui). */
export type Language = 'vi' | 'en';
export type ThemePreference = 'dark' | 'light' | 'system';
export type Palette = 'dau-tam' | 'hoa-dao' | 'oai-huong';
export type FontSize = 14 | 16 | 18;
/** design.md §12: "Bento mềm" (the default since M5) or "Yên tĩnh" (the earlier layout). */
export type Style = 'bento' | 'calm';

export interface UiPrefs {
  name: string;
  language: Language;
  theme: ThemePreference;
  palette: Palette;
  fontSize: FontSize;
  style: Style;
}

export const LANGUAGES: readonly Language[] = ['vi', 'en'];
export const THEMES: readonly ThemePreference[] = ['dark', 'light', 'system'];
export const PALETTES: readonly Palette[] = ['dau-tam', 'hoa-dao', 'oai-huong'];
export const FONT_SIZES: readonly FontSize[] = [14, 16, 18];
export const STYLES: readonly Style[] = ['bento', 'calm'];

/** The product default (F35.1): missing or invalid `ui.style` means Bento. */
export const PRODUCT_DEFAULT_STYLE: Style = 'bento';

/**
 * The default of a build mode. Unit and component tests run with `MODE === 'test'` and were
 * written for the calm layout, so they default to calm; a bento test opts in with
 * `withStyle('bento')` (lib/testing/ui-style-test-kit.ts).
 */
export function defaultStyleForMode(mode: string | undefined): Style {
  return mode === 'test' ? 'calm' : PRODUCT_DEFAULT_STYLE;
}

export const DEFAULT_STYLE: Style = defaultStyleForMode(import.meta.env?.MODE);

export const DEFAULT_UI_PREFS: UiPrefs = {
  name: 'khangnie',
  language: 'vi',
  theme: 'dark',
  palette: 'dau-tam',
  fontSize: 16,
  style: DEFAULT_STYLE,
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
    style: pick(STYLES, raw.style, DEFAULT_UI_PREFS.style),
  };
}
