import { copyFile, readFile } from 'node:fs/promises';
import { atomicWriteFile } from '../fs/atomic-write-file.js';
import { generateSessionToken, isWellFormedToken } from '../security/session-token.js';
import { DEFAULT_PORT } from './cli-args.js';

export type UiLanguage = 'vi' | 'en';
export type UiTheme = 'dark' | 'light' | 'system';
export type UiPalette = 'dau-tam' | 'hoa-dao' | 'oai-huong';
export type UiFontSize = 14 | 16 | 18;

export interface UiSettings {
  name: string;
  language: UiLanguage;
  theme: UiTheme;
  palette: UiPalette;
  fontSize: UiFontSize;
}

/** Machine-wide settings in `<home>/.secondbrain/settings.json`. Unknown keys are preserved. */
export interface GlobalSettings {
  version: 1;
  port: number;
  sessionToken: string;
  vaultPath: string | null;
  ui: UiSettings;
  [extra: string]: unknown;
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  name: 'khangnie',
  language: 'vi',
  theme: 'dark',
  palette: 'dau-tam',
  fontSize: 16,
};

const LANGUAGES: readonly UiLanguage[] = ['vi', 'en'];
const THEMES: readonly UiTheme[] = ['dark', 'light', 'system'];
const PALETTES: readonly UiPalette[] = ['dau-tam', 'hoa-dao', 'oai-huong'];
const FONT_SIZES: readonly UiFontSize[] = [14, 16, 18];

function pick<T>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeUi(raw: unknown): UiSettings {
  const ui = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name =
    typeof ui.name === 'string' && ui.name.trim() !== ''
      ? ui.name.slice(0, 80)
      : DEFAULT_UI_SETTINGS.name;
  return {
    ...ui,
    name,
    language: pick(LANGUAGES, ui.language, DEFAULT_UI_SETTINGS.language),
    theme: pick(THEMES, ui.theme, DEFAULT_UI_SETTINGS.theme),
    palette: pick(PALETTES, ui.palette, DEFAULT_UI_SETTINGS.palette),
    fontSize: pick(FONT_SIZES, ui.fontSize, DEFAULT_UI_SETTINGS.fontSize),
  };
}

/** Fills missing or invalid fields with defaults; keeps every other key untouched. */
export function normalizeSettings(raw: Record<string, unknown>): GlobalSettings {
  const port =
    Number.isInteger(raw.port) && (raw.port as number) > 0 && (raw.port as number) < 65536;
  return {
    ...raw,
    version: 1,
    port: port ? (raw.port as number) : DEFAULT_PORT,
    sessionToken: isWellFormedToken(raw.sessionToken) ? raw.sessionToken : generateSessionToken(),
    vaultPath: typeof raw.vaultPath === 'string' && raw.vaultPath !== '' ? raw.vaultPath : null,
    ui: normalizeUi(raw.ui),
  };
}

export interface LoadSettingsResult {
  settings: GlobalSettings;
  created: boolean;
  /** Path of the backup copy when the existing file could not be parsed. */
  corruptBackup?: string;
}

export async function saveGlobalSettings(file: string, settings: GlobalSettings): Promise<void> {
  // Owner-only on POSIX: the file holds the session token (and API keys from Phase 3).
  await atomicWriteFile(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Reads the settings file, creating it (with a new session token) on first run.
 * A corrupt file is copied to `settings.json.corrupt-<timestamp>` before defaults are written,
 * so nothing the user had is silently lost.
 */
export async function loadOrCreateGlobalSettings(file: string): Promise<LoadSettingsResult> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const settings = normalizeSettings({});
    await saveGlobalSettings(file, settings);
    return { settings, created: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not an object');
  } catch {
    const corruptBackup = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await copyFile(file, corruptBackup);
    const settings = normalizeSettings({});
    await saveGlobalSettings(file, settings);
    return { settings, created: true, corruptBackup };
  }

  const raw = parsed as Record<string, unknown>;
  const settings = normalizeSettings(raw);
  if (JSON.stringify(settings) !== JSON.stringify(raw)) await saveGlobalSettings(file, settings);
  return { settings, created: false };
}
