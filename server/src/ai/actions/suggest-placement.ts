/**
 * "Dọn Inbox" (owner request R1): for a note directly in `0 Inbox`, the model proposes a folder –
 * one of the standard folders or their existing subfolders (depth ≤ 2), nothing else – and a
 * clearer title (capture-name rules, ≤ 80 characters). Nothing moves here: the web applies an
 * accepted proposal through the journaled move/rename routes, with undo.
 */
import { noteTitleFromPath } from '../../markdown/content-classes.js';
import { linkIdentityKey } from '../../markdown/normalize-text.js';
import { VaultError, type VaultPath } from '../../vault/vault-types.js';
import { extractJsonObject } from '../intent/intent-validate.js';
import { placementSystem } from '../prompts/action-prompts.js';
import { detectLanguage } from '../prompts/answer-language.js';
import { dataBlock } from '../prompts/data-blocks.js';
import { retrieveChunks } from '../retrieval/retrieve-chunks.js';
import {
  cleanReason,
  PROMPT_TEXT_CHARS,
  QUERY_CHARS,
  unusableReply,
  type ActionDeps,
  type PlacementProposal,
} from './action-types.js';
import { sanitizeNoteTitle } from './note-title.js';

export const INBOX = '0 Inbox';
const STANDARD_FOLDERS = ['1 Projects', '2 Areas', '3 Resources', '4 Archive'];
const MAX_TITLE = 80;
const MAX_RELATED = 5;
const MAX_CANDIDATES = 300;

/** True for `0 Inbox/<name>.md` (any case of the folder name), not for its subfolders. */
export function isDirectlyInInbox(path: VaultPath): boolean {
  const segments = path.split('/');
  return segments.length === 2 && linkIdentityKey(segments[0]!) === linkIdentityKey(INBOX);
}

/**
 * The standard folders (fixed names, always offered) and their subfolders up to two levels down
 * whose notes would be in scope – a subfolder of an excluded folder is never named to the model.
 */
export async function placementCandidates(
  deps: Pick<ActionDeps, 'vault' | 'runtime'>,
): Promise<string[]> {
  const standard = new Map(STANDARD_FOLDERS.map((name) => [linkIdentityKey(name), name]));
  const subfolders: string[] = [];
  for (const folder of (await deps.vault.list()).folders) {
    const segments = folder.split('/');
    if (segments.length < 2 || segments.length > 3) continue;
    if (!standard.has(linkIdentityKey(segments[0]!))) continue;
    if (segments.some((segment) => segment.startsWith('.'))) continue;
    if (deps.runtime.inScope(`${folder}/_.md`)) subfolders.push(folder);
  }
  subfolders.sort((a, b) => a.localeCompare(b, 'vi'));
  return [...STANDARD_FOLDERS, ...subfolders].slice(0, MAX_CANDIDATES);
}

async function relatedTitles(path: VaultPath, text: string, deps: ActionDeps): Promise<string[]> {
  const retrieval = await retrieveChunks(text.slice(0, QUERY_CHARS), {
    ...deps,
    exclude: new Set([path]),
    chunkLimit: 30,
    charLimit: Number.POSITIVE_INFINITY,
  });
  const out: string[] = [];
  for (const chunk of retrieval.chunks) {
    const folder = chunk.path.includes('/') ? chunk.path.slice(0, chunk.path.lastIndexOf('/')) : '';
    const line = `- ${chunk.title}${folder ? ` (${folder})` : ''}`;
    if (!out.includes(line)) out.push(line);
    if (out.length === MAX_RELATED) break;
  }
  return out;
}

export async function suggestPlacement(
  path: VaultPath,
  deps: ActionDeps,
): Promise<PlacementProposal> {
  const note = await deps.vault.read(path);
  if (!note.utf8) {
    throw new VaultError('VALIDATION', 'The note is not UTF-8 text.', { reason: 'not-utf8' });
  }
  const current = { folder: path.split('/')[0]!, title: noteTitleFromPath(path) };
  const candidates = await placementCandidates(deps);
  const related = await relatedTitles(path, note.content, deps);
  const language = detectLanguage(note.content, deps.uiLanguage);
  const reply = await deps.runtime.complete({
    purpose: 'action',
    json: true,
    maxTokens: 400,
    temperature: 0,
    system: placementSystem(language),
    messages: [
      {
        role: 'user',
        content: [
          dataBlock('note', `${current.title}\n\n${note.content.slice(0, PROMPT_TEXT_CHARS)}`),
          dataBlock('candidates', candidates.join('\n')),
          dataBlock('source', related.join('\n') || '(none)'),
        ].join('\n\n'),
      },
    ],
    signal: deps.signal,
  });
  const parsed = extractJsonObject(reply.text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw unusableReply('malformed');
  }
  const answer = parsed as Record<string, unknown>;
  const reason = cleanReason(answer.reason);
  if (answer.keep === true) return { current, ...current, reason, keep: true };
  const wanted = typeof answer.folder === 'string' ? answer.folder.trim().replace(/\/+$/, '') : '';
  const folder = candidates.find((c) => linkIdentityKey(c) === linkIdentityKey(wanted));
  if (!folder) throw unusableReply('invalid-answer');
  const title =
    (typeof answer.title === 'string' ? sanitizeNoteTitle(answer.title, MAX_TITLE) : null) ??
    current.title;
  return { current, folder, title, reason, keep: false };
}
