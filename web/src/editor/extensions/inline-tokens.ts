import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/** A tag or task date token inside one textblock (document positions). */
export type InlineToken =
  | { kind: 'tag'; from: number; to: number; tag: string }
  | { kind: 'due' | 'done'; from: number; to: number; date: string };

// Same rules as the server (inline-tags.ts, task-tokens.ts): a tag starts after a line start,
// whitespace or `(` (not `](`), is made of letters, marks, digits, `_`, `-`, `/`, needs a letter
// and drops a trailing `/`; date tokens are `📅`/`✅` + optional spaces + `YYYY-MM-DD`.
const TAG = /(^|[\s(])#([\p{L}\p{N}\p{M}_/-]+)/gu;
const HAS_LETTER = /\p{L}/u;
const DATE_TOKEN = /(\u{1F4C5}|✅)️?[ \t]*(\d{4}-\d{2}-\d{2})(?!\d)/gu;
const OBJECT = '￼';
const MASK = '\u0000';

/**
 * Text of a textblock with one character per document position: text in code or link marks is
 * masked (never a tag or date there), inline atoms become an object character (a tag cannot
 * follow `]]` directly) and hard breaks a line end.
 */
export function maskedText(textblock: ProseMirrorNode): string {
  let text = '';
  textblock.forEach((child) => {
    if (child.isText) {
      const masked = child.marks.some((m) => m.type.name === 'code' || m.type.name === 'link');
      text += masked ? MASK.repeat(child.nodeSize) : (child.text ?? '');
    } else {
      text += child.type.name === 'hardBreak' ? '\n' : OBJECT.repeat(child.nodeSize);
    }
  });
  return text;
}

/** Tags and date tokens of a textblock starting at document position `start` (its content). */
export function scanInlineTokens(textblock: ProseMirrorNode, start: number): InlineToken[] {
  if (textblock.type.spec.code) return [];
  const text = maskedText(textblock);
  if (!text.includes('#') && !text.includes('\u{1F4C5}') && !text.includes('✅')) return [];
  const tokens: InlineToken[] = [];
  for (const match of text.matchAll(TAG)) {
    const prefix = match[1] ?? '';
    const hash = (match.index ?? 0) + prefix.length;
    if (prefix === '(' && text.charAt(hash - 2) === ']') continue;
    const tag = (match[2] ?? '').replace(/\/+$/, '');
    if (tag === '' || !HAS_LETTER.test(tag)) continue;
    tokens.push({ kind: 'tag', from: start + hash, to: start + hash + 1 + tag.length, tag });
  }
  for (const match of text.matchAll(DATE_TOKEN)) {
    const from = start + (match.index ?? 0);
    const kind = match[1] === '✅' ? 'done' : 'due';
    tokens.push({ kind, from, to: from + match[0].length, date: match[2] ?? '' });
  }
  return tokens.sort((a, b) => a.from - b.from);
}
