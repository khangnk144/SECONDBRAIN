/**
 * The AI part of `PUT /api/settings` (SPEC F33): schema, cleaning (model names trimmed, folder
 * scope guarded, key format) and apply (provider, consent, then switching on). Keys are set by
 * sending a string and removed with `null`; they are never echoed, not even in an error.
 */
import type { EmbeddingProvider } from '../ai/ai-types.js';
import { bodyValidationError, type BodySchema } from '../http/strict-body-schema.js';
import { guardVaultPath } from '../security/path-guard.js';
import type { VaultError } from '../vault/vault-types.js';
import type { GlobalSettings } from './global-settings.js';
import {
  AI_PROVIDERS,
  EMBEDDING_PROVIDERS,
  MAX_MONTHLY_TOKEN_LIMIT,
  MIN_MONTHLY_TOKEN_LIMIT,
  hasChatConsent,
  hasEmbeddingsConsent,
  type AiProvider,
} from './settings-sections.js';

export interface AiSettingsPatch {
  provider?: AiProvider;
  chatModel?: string | null;
  embeddingModel?: string | null;
  folders?: string[] | null;
  enabled?: boolean;
  embeddings?: boolean;
  /** Sets (`value`) or removes (`null`) the key of one provider; keys are never read back. */
  apiKey?: { provider: AiProvider; value: string | null };
  /** `true` records consent for the (resulting) provider now; `false` withdraws it. */
  consent?: boolean;
  /** Same for embeddings, tied to the (resulting) embedding provider. */
  embeddingsConsent?: boolean;
  embeddingProvider?: EmbeddingProvider;
  monthlyTokenLimit?: number;
}

/** A strict object of `properties` (unknown keys refused). */
export const section = (properties: Record<string, BodySchema>): BodySchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
});
const nullableText: BodySchema = { type: ['string', 'null'], maxLength: 200 };

export const AI_PATCH_SCHEMA: BodySchema = section({
  provider: { type: 'string', enum: AI_PROVIDERS },
  chatModel: nullableText,
  embeddingModel: nullableText,
  folders: { type: ['array', 'null'], maxItems: 200, items: { type: 'string', maxLength: 1024 } },
  enabled: { type: 'boolean' },
  embeddings: { type: 'boolean' },
  apiKey: {
    ...section({
      provider: { type: 'string', enum: AI_PROVIDERS },
      value: { type: ['string', 'null'], maxLength: 1024 },
    }),
    required: ['provider', 'value'],
  },
  consent: { type: 'boolean' },
  embeddingsConsent: { type: 'boolean' },
  embeddingProvider: { type: 'string', enum: EMBEDDING_PROVIDERS },
  monthlyTokenLimit: {
    type: 'integer',
    minimum: MIN_MONTHLY_TOKEN_LIMIT,
    maximum: MAX_MONTHLY_TOKEN_LIMIT,
  },
});

/** Printable ASCII without spaces: every provider's keys look like that, and are long. */
const API_KEY = /^[\x21-\x7e]{16,512}$/;

export const fieldError = (field: string, reason: string, message?: string): VaultError =>
  bodyValidationError({ field, reason }, message);

function cleanFolders(folders: string[]): string[] {
  const out: string[] = [];
  for (const [i, folder] of folders.entries()) {
    const trimmed = folder.trim().replace(/\/+$/, '');
    let guarded: string;
    if (trimmed === '') {
      guarded = ''; // notes at the vault root
    } else {
      try {
        guarded = guardVaultPath(trimmed);
      } catch {
        throw fieldError(`ai.folders.${i}`, 'invalid-path');
      }
    }
    if (!out.includes(guarded)) out.push(guarded);
  }
  return out;
}

export function cleanAiPatch(ai: AiSettingsPatch): void {
  for (const key of ['chatModel', 'embeddingModel'] as const) {
    const value = ai[key];
    if (typeof value === 'string') ai[key] = value.trim() === '' ? null : value.trim();
  }
  if (ai.folders) ai.folders = cleanFolders(ai.folders);
  if (ai.apiKey && ai.apiKey.value !== null) {
    const value = ai.apiKey.value.trim();
    if (!API_KEY.test(value)) throw fieldError('ai.apiKey.value', 'api-key-format');
    ai.apiKey.value = value;
  }
}

/**
 * The AI part of a patch. Order matters: the provider choice first, then consent (recorded for the
 * provider chosen after the patch), then switching on, which needs a consent that counts. A
 * provider change keeps the old consent stored; it simply stops counting (SPEC F33 consent).
 */
export function applyAiPatch(draft: GlobalSettings, ai: AiSettingsPatch, now: Date): void {
  const target = draft.ai;
  // A model name belongs to one provider: switching provider without naming a model goes back to
  // the new provider's default instead of sending it the old provider's model id.
  if (ai.provider !== undefined && ai.provider !== target.provider) target.chatModel = null;
  if (ai.embeddingProvider !== undefined && ai.embeddingProvider !== target.embeddingProvider)
    target.embeddingModel = null;
  if (ai.provider !== undefined) target.provider = ai.provider;
  if (ai.embeddingProvider !== undefined) target.embeddingProvider = ai.embeddingProvider;
  if (ai.chatModel !== undefined) target.chatModel = ai.chatModel;
  if (ai.embeddingModel !== undefined) target.embeddingModel = ai.embeddingModel;
  if (ai.folders !== undefined) target.folders = ai.folders;
  if (ai.monthlyTokenLimit !== undefined) target.monthlyTokenLimit = ai.monthlyTokenLimit;
  if (ai.apiKey) {
    if (ai.apiKey.value === null) delete target.apiKeys[ai.apiKey.provider];
    else target.apiKeys[ai.apiKey.provider] = ai.apiKey.value;
  }
  const at = now.toISOString();
  if (ai.consent === true) target.consent = { at, provider: target.provider };
  if (ai.consent === false) target.consent = null;
  if (ai.embeddingsConsent === true)
    target.embeddingsConsent = { at, provider: target.embeddingProvider };
  if (ai.embeddingsConsent === false) target.embeddingsConsent = null;
  if (ai.enabled === true && !hasChatConsent(target)) {
    throw fieldError(
      'ai.enabled',
      'consent-required',
      'Agree to what AI sends before turning it on.',
    );
  }
  if (ai.embeddings === true && !hasEmbeddingsConsent(target)) {
    throw fieldError(
      'ai.embeddings',
      'consent-required',
      'Agree to what embeddings send before turning them on.',
    );
  }
  if (ai.enabled !== undefined) target.enabled = ai.enabled;
  if (ai.embeddings !== undefined) target.embeddings = ai.embeddings;
}
