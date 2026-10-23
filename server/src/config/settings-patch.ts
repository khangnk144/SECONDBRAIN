import { assertBody, type BodySchema } from '../http/strict-body-schema.js';
import {
  UI_CHOICES,
  UI_NAME_MAX,
  type GlobalSettings,
  type UiSettings,
} from './global-settings.js';
import { REMINDER_TIME_PATTERN, mcpSettingsOf } from './settings-sections.js';
import {
  AI_PATCH_SCHEMA,
  applyAiPatch,
  cleanAiPatch,
  fieldError,
  section,
  type AiSettingsPatch,
} from './settings-patch-ai.js';
import {
  M5_PATCH_PROPERTIES,
  applyM5Patch,
  cleanM5Patch,
  type SettingsPatchM5,
} from './settings-patch-m5.js';

/** What `PUT /api/settings` may change; the token and `vaultPath` are not in it on purpose. */
export interface SettingsPatch extends SettingsPatchM5 {
  ui?: Partial<UiSettings>;
  reminders?: { time?: string };
  system?: { runAtLogin?: boolean; tray?: boolean };
  port?: number;
  ai?: AiSettingsPatch;
  mcp?: { allowNoteEdits?: boolean };
}

export const SETTINGS_PATCH_SCHEMA: BodySchema = section({
  ui: section({
    name: { type: 'string', maxLength: 400 },
    language: { type: 'string', enum: UI_CHOICES.language },
    theme: { type: 'string', enum: UI_CHOICES.theme },
    palette: { type: 'string', enum: UI_CHOICES.palette },
    fontSize: { type: 'integer', enum: UI_CHOICES.fontSize },
    style: { type: 'string', enum: UI_CHOICES.style },
  }),
  reminders: section({ time: { type: 'string', pattern: REMINDER_TIME_PATTERN.source } }),
  system: section({ runAtLogin: { type: 'boolean' }, tray: { type: 'boolean' } }),
  port: { type: 'integer', minimum: 1024, maximum: 65535 },
  ai: AI_PATCH_SCHEMA,
  mcp: section({ allowNoteEdits: { type: 'boolean' } }),
  ...M5_PATCH_PROPERTIES,
});

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
  if (patch.ai) cleanAiPatch(patch.ai);
  cleanM5Patch(patch);
  return patch;
}

/** True when the patch touches what the AI plugin depends on (it re-evaluates and tells clients). */
export function patchTouchesAi(patch: SettingsPatch): boolean {
  return patch.ai !== undefined || patch.mcp !== undefined;
}

/**
 * Applies a parsed patch to a settings draft (see `SettingsStore.update`). Throws 400
 * `consent-required` (nothing applied: the draft is discarded) when AI or embeddings would be
 * switched on without a consent for the provider in use.
 */
export function applySettingsPatch(
  draft: GlobalSettings,
  patch: SettingsPatch,
  now: Date = new Date(),
): void {
  if (patch.ui) Object.assign(draft.ui, patch.ui);
  if (patch.reminders?.time !== undefined) draft.reminders.time = patch.reminders.time;
  if (patch.system?.runAtLogin !== undefined) draft.system.runAtLogin = patch.system.runAtLogin;
  if (patch.system?.tray !== undefined) draft.system.tray = patch.system.tray;
  if (patch.port !== undefined) draft.port = patch.port;
  if (patch.mcp?.allowNoteEdits !== undefined) {
    draft.mcp = { ...mcpSettingsOf(draft), allowNoteEdits: patch.mcp.allowNoteEdits };
  }
  if (patch.ai) applyAiPatch(draft, patch.ai, now);
  applyM5Patch(draft, patch);
}
