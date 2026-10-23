/**
 * The sections of the global settings added after M1 (reminder time, run at login, AI, MCP).
 * Each normalizer keeps unknown keys (a newer version may have written them) and fills missing or
 * invalid fields with their defaults, like `ui`.
 */
import type { EmbeddingProvider } from '../ai/ai-types.js';

export type AiProvider = 'anthropic' | 'openai' | 'gemini';
export const AI_PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai', 'gemini'];
/** Anthropic has no embeddings API. */
export const EMBEDDING_PROVIDERS: readonly EmbeddingProvider[] = ['openai', 'gemini'];

export interface ReminderSettings {
  /** Local time of day reminders fire at, `HH:mm`. */
  time: string;
}

export interface SystemSettings {
  /** What the user asked for; the Startup shortcut on disk is the truth GET reports. */
  runAtLogin: boolean;
  /** "Biểu tượng khay và phím tắt" (SPEC F29.2): the Windows tray helper; default on. */
  tray: boolean;
}

/** When she agreed to send note text to a provider (SPEC F33 consent). Tied to that provider. */
export interface AiConsent<P extends string = AiProvider> {
  /** ISO timestamp. */
  at: string;
  provider: P;
}

export interface AiSettings {
  provider: AiProvider;
  apiKeys: Partial<Record<AiProvider, string>>;
  chatModel: string | null;
  embeddingModel: string | null;
  /**
   * Vault folders AI may read (top folders or deeper; '' = notes at the vault root); null = the
   * default scope (every top folder except `3 Resources` and `4 Archive`, plus root notes).
   */
  folders: string[] | null;
  enabled: boolean;
  embeddings: boolean;
  /** Consent for chat calls; counts only while `provider` is still the same. */
  consent: AiConsent | null;
  /** Separate opt-in for embeddings; counts only while `embeddingProvider` is the same. */
  embeddingsConsent: AiConsent<EmbeddingProvider> | null;
  embeddingProvider: EmbeddingProvider;
  /** Monthly cost cap in tokens (chat and embeddings together, per machine). */
  monthlyTokenLimit: number;
}

/** Top-level `mcp` section (route A, SPEC F32). */
export interface McpSettings {
  /** "Cho phép AI sửa ghi chú cá nhân": MCP may rewrite existing user notes (revision-checked). */
  allowNoteEdits: boolean;
}

export const DEFAULT_REMINDER_TIME = '08:00';
export const REMINDER_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DEFAULT_MONTHLY_TOKEN_LIMIT = 2_000_000;
export const MIN_MONTHLY_TOKEN_LIMIT = 10_000;
export const MAX_MONTHLY_TOKEN_LIMIT = 100_000_000;

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
  return { ...section, runAtLogin: section.runAtLogin === true, tray: section.tray !== false };
}

function normalizeApiKeys(raw: unknown): Partial<Record<AiProvider, string>> {
  const keys: Record<string, unknown> = { ...record(raw) };
  for (const provider of AI_PROVIDERS) {
    if (typeof keys[provider] !== 'string' || keys[provider] === '') delete keys[provider];
  }
  return keys as Partial<Record<AiProvider, string>>;
}

function normalizeConsent<P extends string>(
  raw: unknown,
  allowed: readonly P[],
): AiConsent<P> | null {
  const consent = record(raw);
  if (typeof consent.at !== 'string' || Number.isNaN(Date.parse(consent.at))) return null;
  if (!allowed.includes(consent.provider as P)) return null;
  return { at: consent.at, provider: consent.provider as P };
}

function normalizeLimit(raw: unknown): number {
  return Number.isInteger(raw) &&
    (raw as number) >= MIN_MONTHLY_TOKEN_LIMIT &&
    (raw as number) <= MAX_MONTHLY_TOKEN_LIMIT
    ? (raw as number)
    : DEFAULT_MONTHLY_TOKEN_LIMIT;
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
    consent: normalizeConsent(section.consent, AI_PROVIDERS),
    embeddingsConsent: normalizeConsent(section.embeddingsConsent, EMBEDDING_PROVIDERS),
    embeddingProvider: EMBEDDING_PROVIDERS.includes(section.embeddingProvider as EmbeddingProvider)
      ? (section.embeddingProvider as EmbeddingProvider)
      : 'openai',
    monthlyTokenLimit: normalizeLimit(section.monthlyTokenLimit),
  };
}

export function normalizeMcp(raw: unknown): McpSettings {
  const section = record(raw);
  return { ...section, allowNoteEdits: section.allowNoteEdits === true };
}

/**
 * The `mcp` section of any settings object. `GlobalSettings` keeps it as an extra top-level key,
 * so readers (MCP permissions, the settings response) go through this instead of trusting it.
 */
export function mcpSettingsOf(settings: { readonly [key: string]: unknown }): McpSettings {
  return normalizeMcp(settings.mcp);
}

/** A stored chat consent that still counts (given for the provider chosen now). */
export function hasChatConsent(ai: AiSettings): boolean {
  return ai.consent !== null && ai.consent.provider === ai.provider;
}

/** A stored embeddings consent that still counts (given for the embedding provider chosen now). */
export function hasEmbeddingsConsent(ai: AiSettings): boolean {
  return ai.embeddingsConsent !== null && ai.embeddingsConsent.provider === ai.embeddingProvider;
}

/** Every stored API key (the logger redacts them; tests scan responses for them). */
export function storedApiKeys(ai: AiSettings): string[] {
  return Object.values(ai.apiKeys).filter((key): key is string => typeof key === 'string');
}
