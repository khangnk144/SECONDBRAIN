/**
 * `POST /api/ai/action` (SPEC F33 editor actions, R1 Inbox tidying): checks the body strictly,
 * refuses actions on notes outside the AI scope (`VALIDATION`, `reason: 'out-of-scope'`), then
 * runs the action. Every result is a proposal; nothing in the vault changes here.
 */
import { assertBody, type BodySchema } from '../../http/strict-body-schema.js';
import { guardVaultPath } from '../../security/path-guard.js';
import { isNotePath } from '../../markdown/content-classes.js';
import { VaultError, type VaultPath } from '../../vault/vault-types.js';
import type { ActionDeps, ActionName } from './action-types.js';
import { suggestLinks } from './suggest-links.js';
import { isDirectlyInInbox, suggestPlacement } from './suggest-placement.js';
import { suggestTags } from './suggest-tags.js';
import { runTextAction } from './text-actions.js';

export const MAX_ACTION_TEXT = 20_000;

export const ACTION_BODY_SCHEMA: BodySchema = {
  type: 'object',
  required: ['action'],
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: [
        'summarize',
        'improve',
        'explain',
        'suggest-links',
        'suggest-tags',
        'suggest-placement',
      ],
    },
    text: { type: 'string', maxLength: MAX_ACTION_TEXT },
    path: { type: 'string', maxLength: 4096 },
  },
};

export interface ActionBody {
  action: ActionName;
  text?: string;
  path?: string;
}

function invalid(message: string, details: Record<string, unknown>): VaultError {
  return new VaultError('VALIDATION', message, details);
}

/** A guarded `.md` path inside the AI scope (an action on any other note is refused). */
export function scopedNotePath(input: string, inScope: (path: VaultPath) => boolean): VaultPath {
  const path = guardVaultPath(input);
  if (!isNotePath(path)) {
    throw invalid('Only Markdown notes (.md) can be used here.', {
      field: 'path',
      reason: 'not-a-note',
    });
  }
  if (!inScope(path)) {
    throw invalid('This note is in a folder AI may not read.', {
      field: 'path',
      reason: 'out-of-scope',
    });
  }
  return path;
}

export async function runAction(rawBody: unknown, deps: ActionDeps): Promise<unknown> {
  const body = assertBody<ActionBody>(ACTION_BODY_SCHEMA, rawBody);
  const inScope = (path: VaultPath) => deps.runtime.inScope(path);
  if (body.action === 'suggest-placement') {
    if (body.text !== undefined)
      throw invalid('No text for this action.', { field: 'text', reason: 'unknown-field' });
    if (body.path === undefined)
      throw invalid('A note path is needed.', { field: 'path', reason: 'required' });
    const path = scopedNotePath(body.path, inScope);
    if (!isDirectlyInInbox(path)) {
      throw invalid('Only notes directly in 0 Inbox can be tidied.', {
        field: 'path',
        reason: 'not-in-inbox',
      });
    }
    return suggestPlacement(path, deps);
  }
  const text = (body.text ?? '').normalize('NFC');
  if (text.trim() === '')
    throw invalid('Select some text first.', { field: 'text', reason: 'required' });
  const path = body.path === undefined ? null : scopedNotePath(body.path, inScope);
  switch (body.action) {
    case 'suggest-links':
      return suggestLinks(text, path, deps);
    case 'suggest-tags':
      return suggestTags(text, path, deps);
    default:
      return runTextAction(body.action, text, deps);
  }
}
