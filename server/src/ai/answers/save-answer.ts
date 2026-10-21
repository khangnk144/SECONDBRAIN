/**
 * "Lưu thành ghi chú" (SPEC F33, design.md screen 7): a question and its answer become a new note
 * in a user-note folder or under `wiki/` (never Templates, 3 Resources, 4 Archive, attachments,
 * a control doc or `.secondbrain`), named after the question (capture-name rules, 60 characters),
 * created with `createUnique` (never overwrites). Links in the answer are checked once more: one
 * that no longer resolves becomes plain text.
 */
import { classifyPath } from '../../markdown/content-classes.js';
import type { LinkCatalog } from '../../markdown/markdown-types.js';
import { resolveLink } from '../../markdown/resolve-link.js';
import { scanWikilinks, type WikilinkHit } from '../../markdown/wikilink-scan.js';
import { guardVaultPath } from '../../security/path-guard.js';
import { assertBody, type BodySchema } from '../../http/strict-body-schema.js';
import { toLocalDate } from '../../lib/local-date.js';
import { VaultError, type VaultPath, type VaultService } from '../../vault/vault-types.js';
import { sanitizeNoteTitle } from '../actions/note-title.js';
import type { AnswerLanguage } from '../prompts/answer-language.js';

export const MAX_ANSWER_BYTES = 100 * 1024;
const MAX_NAME = 60;

export const SAVE_ANSWER_SCHEMA: BodySchema = {
  type: 'object',
  required: ['question', 'answer', 'folder'],
  additionalProperties: false,
  properties: {
    question: { type: 'string', minLength: 1, maxLength: 4000 },
    answer: { type: 'string', maxLength: MAX_ANSWER_BYTES },
    folder: { type: 'string', maxLength: 4096 },
  },
};

export interface SaveAnswerBody {
  question: string;
  answer: string;
  folder: string;
}

export interface SaveAnswerDeps {
  vault: Pick<VaultService, 'createUnique' | 'realPath'>;
  catalog: () => LinkCatalog;
  now: Date;
  language: AnswerLanguage;
}

const refused = (reason: string, message: string) =>
  new VaultError('VALIDATION', message, { field: 'folder', reason });

/** `''` (vault root) or a guarded folder path without a trailing slash. */
function targetFolder(input: string): string {
  const trimmed = input.replace(/\\/g, '/').replace(/\/+$/, '');
  return trimmed === '' ? '' : guardVaultPath(trimmed);
}

/** Links that resolve stay; others become their text (the alias, else the title). */
export function keepResolvingLinks(
  text: string,
  catalog: LinkCatalog,
  fromPath: VaultPath,
): string {
  const hits: WikilinkHit[] = [];
  scanWikilinks(text, 0, text.length, (hit) => hits.push(hit));
  let out = '';
  let last = 0;
  for (const hit of hits) {
    out += text.slice(last, hit.start);
    const resolution =
      hit.target === ''
        ? null
        : resolveLink(catalog, { kind: 'wikilink', target: hit.target }, fromPath);
    if (resolution?.status === 'resolved') out += text.slice(hit.start, hit.end);
    else
      out += hit.alias ?? hit.target.slice(hit.target.lastIndexOf('/') + 1).replace(/\.md$/i, '');
    last = hit.end;
  }
  return out + text.slice(last);
}

function noteContent(body: SaveAnswerBody, title: string, deps: SaveAnswerDeps, path: VaultPath) {
  const date = toLocalDate(deps.now);
  const type = classifyPath(path) === 'wiki' ? 'wiki' : 'note';
  const clean = (s: string) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  const quote = clean(body.question)
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n');
  const answer = keepResolvingLinks(clean(body.answer), deps.catalog(), path);
  const [y, m, d] = date.split('-');
  const signed =
    deps.language === 'vi'
      ? `*Câu trả lời của AI, ${d}/${m}/${y}.*`
      : `*AI answer, ${d}/${m}/${y}.*`;
  return `---\ntype: ${type}\ncreated: ${date}\nsource: ai-chat\n---\n\n# ${title}\n\n${quote}\n\n${answer}\n\n${signed}\n`;
}

export async function saveAnswer(
  rawBody: unknown,
  deps: SaveAnswerDeps,
): Promise<{ path: VaultPath }> {
  const body = assertBody<SaveAnswerBody>(SAVE_ANSWER_SCHEMA, rawBody);
  if (Buffer.byteLength(body.answer, 'utf8') > MAX_ANSWER_BYTES) {
    throw new VaultError('VALIDATION', 'The answer is too long to save.', {
      field: 'answer',
      reason: 'too-long',
    });
  }
  if (body.question.trim() === '' || body.answer.trim() === '') {
    throw new VaultError('VALIDATION', 'Nothing to save.', { field: 'answer', reason: 'empty' });
  }
  const folder = targetFolder(body.folder);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${toLocalDate(deps.now)} ${pad(deps.now.getHours())}-${pad(deps.now.getMinutes())}`;
  let title = sanitizeNoteTitle(body.question, MAX_NAME) ?? `Hỏi AI ${stamp}`;
  const at = (name: string) => (folder === '' ? `${name}.md` : `${folder}/${name}.md`);
  // `wiki/index` or a root `CLAUDE` would be a control doc: keep the answer an ordinary page.
  if (classifyPath(at(title)) === 'control') title = `${title} 2`;
  const kind = classifyPath(at(title));
  if (kind !== 'user' && kind !== 'wiki') {
    throw refused('folder-not-allowed', 'Answers can be saved in your own folders or in wiki/.');
  }
  const path = at(title);
  // The class was judged on the requested folder: a folder link (`wiki/mau` → `Templates`) or a
  // Windows short name would put the answer somewhere that was never judged.
  const real = await deps.vault.realPath(path);
  if (real.normalize('NFC').toLowerCase() !== path.normalize('NFC').toLowerCase()) {
    throw new VaultError('FORBIDDEN', 'Answers are not saved through a folder link.', {
      field: 'folder',
      reason: 'linked-path',
    });
  }
  const created = await deps.vault.createUnique(path, noteContent(body, title, deps, path));
  return { path: created.path };
}
