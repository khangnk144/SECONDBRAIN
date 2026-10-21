/**
 * The M4 sections of the global settings (reminder time, run at login, AI). Each normalizer keeps
 * unknown keys (a newer version may have written them) and fills missing or invalid fields with
 * their defaults, like `ui`.
 */

export type AiProvider = 'anthropic' | 'openai' | 'gemini';
export const AI_PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai', 'gemini'];

export interface ReminderSettings {
  /** Local time of day reminders fire at, `HH:mm`. */
  time: string;
}

export interface SystemSettings {
  /** What the user asked for; the Startup shortcut on disk is the truth GET reports. */
  runAtLogin: boolean;
}

/** AI features are Phase 3: M4 stores these and never returns a key in full. */
export interface AiSettings {
  provider: AiProvider;
  apiKeys: Partial<Record<AiProvider, string>>;
  chatModel: string | null;
  embeddingModel: string | null;
  /** Vault folders AI may read; null = the default scope (all but `3 Resources`, `4 Archive`). */
  folders: string[] | null;
  enabled: boolean;
  embeddings: boolean;
}

export const DEFAULT_REMINDER_TIME = '08:00';
export const REMINDER_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function record(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

export function normalizeReminders(raw: unknown): ReminderSettings {
  const section = record(raw);
  const time =
    typeof section.time === 'string' && REMINDER_TIME_PATTERN.test(section.time)
      ? section.time
      : DEFAULT_REMINDER_TIME;
  return { ...section, time };
}

export function normalizeSystem(raw: unknown): SystemSettings {
  const section = record(raw);
  return { ...section, runAtLogin: section.runAtLogin === true };
}

function normalizeApiKeys(raw: unknown): Partial<Record<AiProvider, string>> {
  const keys: Record<string, unknown> = { ...record(raw) };
  for (const provider of AI_PROVIDERS) {
    if (typeof keys[provider] !== 'string' || keys[provider] === '') delete keys[provider];
  }
  return keys as Partial<Record<AiProvider, string>>;
}

export function normalizeAi(raw: unknown): AiSettings {
  const section = record(raw);
  const folders = Array.isArray(section.folders)
    ? section.folders.filter((folder): folder is string => typeof folder === 'string')
    : null;
  return {
    ...section,
    provider: AI_PROVIDERS.includes(section.provider as AiProvider)
      ? (section.provider as AiProvider)
      : 'anthropic',
    apiKeys: normalizeApiKeys(section.apiKeys),
    chatModel: textOrNull(section.chatModel),
    embeddingModel: textOrNull(section.embeddingModel),
    folders,
    enabled: section.enabled === true,
    embeddings: section.embeddings === true,
  };
}

/** Every stored API key (the logger redacts them; tests scan responses for them). */
export function storedApiKeys(ai: AiSettings): string[] {
  return Object.values(ai.apiKeys).filter((key): key is string => typeof key === 'string');
}
