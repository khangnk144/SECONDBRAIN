import type { GlobalSettings, UiSettings } from './global-settings.js';
import { AI_PROVIDERS, type AiProvider, type AiSettings } from './settings-sections.js';

export interface VaultInfo {
  /** Absolute path of the open vault. */
  path: string;
  id: string;
  /** The open vault is `<home>/vault`. */
  isDefault: boolean;
  defaultPath: string;
}

export interface ApiKeyStatus {
  set: boolean;
  /** `…` and the last 4 characters (SPEC F18.2), or null. */
  last4: string | null;
}

export interface SettingsResponse {
  /** The port this process listens on. */
  port: number;
  /** The port in settings.json (used from the next start). */
  configuredPort: number;
  restartRequired: boolean;
  ui: UiSettings;
  reminders: { time: string };
  system: { runAtLogin: boolean; runAtLoginSupported: boolean; platform: 'windows' | 'other' };
  /** Null only in API-only builds without a vault (tests). */
  vault: VaultInfo | null;
  ai: Omit<AiSettings, 'apiKeys'> & { keys: Record<AiProvider, ApiKeyStatus> };
}

/** What the response needs besides the stored settings. */
export interface SettingsRuntime {
  port: number;
  platform: NodeJS.Platform;
  /** Whether the Startup shortcut exists on disk, and whether this machine can have one. */
  runAtLogin: { enabled: boolean; supported: boolean };
  vault: VaultInfo | null;
}

/** Below this length the last 4 characters would give away too much of a key. */
const MIN_MASKED_KEY_LENGTH = 16;

export function maskApiKey(key: unknown): ApiKeyStatus {
  if (typeof key !== 'string' || key === '') return { set: false, last4: null };
  return { set: true, last4: key.length >= MIN_MASKED_KEY_LENGTH ? `…${key.slice(-4)}` : null };
}

export function publicUi(ui: UiSettings): UiSettings {
  const { name, language, theme, palette, fontSize } = ui;
  return { name, language, theme, palette, fontSize };
}

/**
 * The client view of the settings, built from an explicit allowlist of fields (never a spread),
 * so the session token and the API keys can never leak through it.
 */
export function buildSettingsResponse(
  settings: GlobalSettings,
  runtime: SettingsRuntime,
): SettingsResponse {
  const { ai } = settings;
  const keys = Object.fromEntries(
    AI_PROVIDERS.map((provider) => [provider, maskApiKey(ai.apiKeys[provider])]),
  ) as Record<AiProvider, ApiKeyStatus>;
  return {
    port: runtime.port,
    configuredPort: settings.port,
    restartRequired: runtime.port !== settings.port,
    ui: publicUi(settings.ui),
    reminders: { time: settings.reminders.time },
    system: {
      runAtLogin: runtime.runAtLogin.enabled,
      runAtLoginSupported: runtime.runAtLogin.supported,
      platform: runtime.platform === 'win32' ? 'windows' : 'other',
    },
    vault: runtime.vault ? { ...runtime.vault } : null,
    ai: {
      provider: ai.provider,
      keys,
      chatModel: ai.chatModel,
      embeddingModel: ai.embeddingModel,
      folders: ai.folders ? [...ai.folders] : null,
      enabled: ai.enabled,
      embeddings: ai.embeddings,
    },
  };
}
