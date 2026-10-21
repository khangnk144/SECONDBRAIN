import { assertBody, bodyValidationError, type BodySchema } from '../http/strict-body-schema.js';
import { guardVaultPath } from '../security/path-guard.js';
import { VaultError } from '../vault/vault-types.js';
import {
  UI_CHOICES,
  UI_NAME_MAX,
  type GlobalSettings,
  type UiSettings,
} from './global-settings.js';
import { AI_PROVIDERS, REMINDER_TIME_PATTERN, type AiProvider } from './settings-sections.js';

/** What `PUT /api/settings` may change; the token and `vaultPath` are not in it on purpose. */
export interface SettingsPatch {
  ui?: Partial<UiSettings>;
  reminders?: { time?: string };
  system?: { runAtLogin?: boolean };
  port?: number;
  ai?: {
    provider?: AiProvider;
    chatModel?: string | null;
    embeddingModel?: string | null;
    folders?: string[] | null;
    enabled?: boolean;
    embeddings?: boolean;
    /** Sets (`value`) or removes (`null`) the key of one provider; keys are never read back. */
    apiKey?: { provider: AiProvider; value: string | null };
  };
}

const section = (properties: Record<string, BodySchema>): BodySchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
});
const nullableText: BodySchema = { type: ['string', 'null'], maxLength: 200 };

export const SETTINGS_PATCH_SCHEMA: BodySchema = section({
  ui: section({
    name: { type: 'string', maxLength: 400 },
    language: { type: 'string', enum: UI_CHOICES.language },
    theme: { type: 'string', enum: UI_CHOICES.theme },
    palette: { type: 'string', enum: UI_CHOICES.palette },
    fontSize: { type: 'integer', enum: UI_CHOICES.fontSize },
  }),
  reminders: section({ time: { type: 'string', pattern: REMINDER_TIME_PATTERN.source } }),
  system: section({ runAtLogin: { type: 'boolean' } }),
  port: { type: 'integer', minimum: 1024, maximum: 65535 },
  ai: section({
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
  }),
});

/** Printable ASCII without spaces: every provider's keys look like that, and are long. */
const API_KEY = /^[\x21-\x7e]{16,512}$/;

const fieldError = (field: string, reason: string, message?: string): VaultError =>
  bodyValidationError({ field, reason }, message);

function cleanFolders(folders: string[]): string[] {
  const out: string[] = [];
  for (const [i, folder] of folders.entries()) {
    let guarded: string;
    try {
      guarded = guardVaultPath(folder.trim().replace(/\/+$/, ''));
    } catch {
      throw fieldError(`ai.folders.${i}`, 'invalid-path');
    }
    if (!out.includes(guarded)) out.push(guarded);
  }
  return out;
}

function cleanAi(ai: NonNullable<SettingsPatch['ai']>): void {
  // AI is Phase 3: nothing can be switched on before it exists.
  if (ai.enabled === true) throw fieldError('ai.enabled', 'ai-not-available');
  if (ai.embeddings === true) throw fieldError('ai.embeddings', 'ai-not-available');
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

/** Validates a `PUT /api/settings` body and returns it cleaned (trimmed, NFC); throws 400. */
export function parseSettingsPatch(body: unknown): SettingsPatch {
  const patch = structuredClone(assertBody<SettingsPatch>(SETTINGS_PATCH_SCHEMA, body));
  if (patch.ui?.name !== undefined) {
    const name = patch.ui.name.normalize('NFC').trim();
    const length = [...name].length;
    if (length < 1 || length > UI_NAME_MAX)
      throw fieldError('ui.name', length < 1 ? 'too-short' : 'too-long');
    patch.ui.name = name;
  }
  if (patch.ai) cleanAi(patch.ai);
  return patch;
}

/** Applies a parsed patch to a settings draft (see `SettingsStore.update`). */
export function applySettingsPatch(draft: GlobalSettings, patch: SettingsPatch): void {
  if (patch.ui) Object.assign(draft.ui, patch.ui);
  if (patch.reminders?.time !== undefined) draft.reminders.time = patch.reminders.time;
  if (patch.system?.runAtLogin !== undefined) draft.system.runAtLogin = patch.system.runAtLogin;
  if (patch.port !== undefined) draft.port = patch.port;
  const ai = patch.ai;
  if (!ai) return;
  if (ai.provider !== undefined) draft.ai.provider = ai.provider;
  if (ai.chatModel !== undefined) draft.ai.chatModel = ai.chatModel;
  if (ai.embeddingModel !== undefined) draft.ai.embeddingModel = ai.embeddingModel;
  if (ai.folders !== undefined) draft.ai.folders = ai.folders;
  if (ai.enabled !== undefined) draft.ai.enabled = ai.enabled;
  if (ai.embeddings !== undefined) draft.ai.embeddings = ai.embeddings;
  if (ai.apiKey) {
    if (ai.apiKey.value === null) delete draft.ai.apiKeys[ai.apiKey.provider];
    else draft.ai.apiKeys[ai.apiKey.provider] = ai.apiKey.value;
  }
}
