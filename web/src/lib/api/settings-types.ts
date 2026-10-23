/**
 * `GET/PUT /api/settings` and the other Settings routes, mirrored by hand from
 * `server/src/config/settings-response.ts` and `server/src/config/settings-patch.ts`.
 */
import type { UiPrefs } from '../ui-prefs';
import type { EmbeddingProvider } from './ai-types';
import type { BackupSettingsView, NotifySettingsView, SettingsPatchM5 } from './settings-m5-types';

export type {
  BackupSettingsView,
  EmailSecurity,
  NotifySettingsView,
  SettingsPatchM5,
} from './settings-m5-types';

export type AiProvider = 'anthropic' | 'openai' | 'gemini';
export const AI_PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai', 'gemini'];
/** Anthropic has no embeddings API. */
export const EMBEDDING_PROVIDERS: readonly EmbeddingProvider[] = ['openai', 'gemini'];

/** Monthly token limit bounds of `PUT /api/settings` (`ai.monthlyTokenLimit`). */
export const MIN_MONTHLY_TOKEN_LIMIT = 10_000;
export const MAX_MONTHLY_TOKEN_LIMIT = 100_000_000;

/** When she agreed to send note text to a provider; counts only for that provider. */
export interface AiConsent<P extends string = AiProvider> {
  /** ISO timestamp. */
  at: string;
  provider: P;
}

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
  system: {
    runAtLogin: boolean;
    runAtLoginSupported: boolean;
    platform: 'windows' | 'other';
    /** "Biểu tượng khay và phím tắt" switch as stored (F29.2). */
    tray: boolean;
  };
  vault: VaultInfo | null;
  ai: {
    provider: AiProvider;
    keys: Record<AiProvider, ApiKeyStatus>;
    chatModel: string | null;
    embeddingModel: string | null;
    /**
     * Folders AI may read ('' = notes at the vault root); null = the default (root notes and
     * every top folder but `3 Resources`, `4 Archive`).
     */
    folders: string[] | null;
    enabled: boolean;
    embeddings: boolean;
    consent: AiConsent | null;
    embeddingsConsent: AiConsent<EmbeddingProvider> | null;
    embeddingProvider: EmbeddingProvider;
    monthlyTokenLimit: number;
  };
  mcp: { allowNoteEdits: boolean };
  backup: BackupSettingsView;
  notify: NotifySettingsView;
}

/** `PUT /api/settings`: only the fields that change (the server refuses unknown keys). */
export interface SettingsPatch extends SettingsPatchM5 {
  ui?: Partial<UiPrefs>;
  reminders?: { time?: string };
  system?: { runAtLogin?: boolean; tray?: boolean };
  port?: number;
  ai?: {
    provider?: AiProvider;
    chatModel?: string | null;
    embeddingModel?: string | null;
    folders?: string[] | null;
    apiKey?: { provider: AiProvider; value: string | null };
    /** Needs a consent that counts (400 `consent-required` otherwise). */
    enabled?: boolean;
    embeddings?: boolean;
    /** `true` records consent for the provider chosen after the patch; `false` withdraws it. */
    consent?: boolean;
    embeddingsConsent?: boolean;
    /** A provider change without a model resets that model to the new provider's default. */
    embeddingProvider?: EmbeddingProvider;
    monthlyTokenLimit?: number;
  };
  mcp?: { allowNoteEdits?: boolean };
}

/** `DELETE /api/sample-data`. */
export interface SampleDataRemoval {
  removed: string[];
  /** Sample files edited since: they are the user's now and stay. */
  kept: string[];
  trashId: string | null;
  journalId: string | null;
}
