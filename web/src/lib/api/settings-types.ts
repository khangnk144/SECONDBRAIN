/**
 * `GET/PUT /api/settings` and the other Settings routes, mirrored by hand from
 * `server/src/config/settings-response.ts` and `server/src/config/settings-patch.ts`.
 */
import type { UiPrefs } from '../ui-prefs';

export type AiProvider = 'anthropic' | 'openai' | 'gemini';
export const AI_PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai', 'gemini'];

export interface ApiKeyStatus {
  set: boolean;
  /** `…` plus the last 4 characters, or null (never the key itself). */
  last4: string | null;
}

export interface VaultInfo {
  /** Absolute folder of the open vault. */
  path: string;
  id: string;
  isDefault: boolean;
  defaultPath: string;
}

export interface SettingsResponse {
  /** The port this server listens on now. */
  port: number;
  /** The port used from the next start. */
  configuredPort: number;
  restartRequired: boolean;
  ui: UiPrefs;
  reminders: { time: string };
  system: { runAtLogin: boolean; runAtLoginSupported: boolean; platform: 'windows' | 'other' };
  vault: VaultInfo | null;
  ai: {
    provider: AiProvider;
    keys: Record<AiProvider, ApiKeyStatus>;
    chatModel: string | null;
    embeddingModel: string | null;
    /** Folders AI may read; null = the default (everything but `3 Resources`, `4 Archive`). */
    folders: string[] | null;
    enabled: boolean;
    embeddings: boolean;
  };
}

/** `PUT /api/settings`: only the fields that change (the server refuses unknown keys). */
export interface SettingsPatch {
  ui?: Partial<UiPrefs>;
  reminders?: { time?: string };
  system?: { runAtLogin?: boolean };
  port?: number;
  ai?: {
    provider?: AiProvider;
    chatModel?: string | null;
    embeddingModel?: string | null;
    folders?: string[] | null;
    apiKey?: { provider: AiProvider; value: string | null };
  };
}

/** `DELETE /api/sample-data`. */
export interface SampleDataRemoval {
  removed: string[];
  /** Sample files edited since: they are the user's now and stay. */
  kept: string[];
  trashId: string | null;
  journalId: string | null;
}
