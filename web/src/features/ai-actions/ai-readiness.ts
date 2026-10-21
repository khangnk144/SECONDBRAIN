/**
 * Why AI cannot be used here right now, checked before anything is sent (SPEC F33: nothing leaves
 * the machine unless AI is enabled with consent, a key exists, the budget allows it and the note
 * is in scope). The same reasons label disabled controls (short form) and the panel (sentences).
 */
import type { AiStatus } from '../../lib/api/ai-types';
import { isInAiScope } from '../../lib/ai-status-store';
import { MAX_SELECTION_CHARS } from './ai-action-kinds';

export type AiBlocker =
  | 'unavailable'
  | 'disabled'
  | 'no-consent'
  | 'no-key'
  | 'budget'
  | 'out-of-scope'
  | 'no-selection'
  | 'too-long'
  | 'source-mode'
  | 'read-only';

/** Readiness and scope; `path` null = no note involved (scope not checked). */
export function aiBlocker(status: AiStatus | null, path: string | null): AiBlocker | null {
  if (!status || !status.available) return 'unavailable';
  if (!status.ready) return status.reason ?? 'disabled';
  if (path !== null && !isInAiScope(status, path)) return 'out-of-scope';
  return null;
}

/** Blockers Settings can lift ("Mở Cài đặt AI"). */
export function blockerNeedsSettings(blocker: AiBlocker): boolean {
  return ['disabled', 'no-consent', 'no-key', 'budget', 'out-of-scope'].includes(blocker);
}

/** Short reason for a disabled control (tooltip, menu item description). */
export function blockerReasonKey(blocker: AiBlocker): string {
  return `ai-actions.reasons.${blocker}`;
}

/** The sentence the panel shows; `values` fill its placeholders. */
export function blockerMessage(
  blocker: AiBlocker,
  status: AiStatus | null,
  locale: string,
): { key: string; values: Record<string, string> } {
  const values: Record<string, string> = {};
  if (blocker === 'budget') values['limit'] = (status?.usage.limit ?? 0).toLocaleString(locale);
  if (blocker === 'too-long') values['max'] = MAX_SELECTION_CHARS.toLocaleString(locale);
  return { key: `ai-actions.blocked.${blocker}`, values };
}
