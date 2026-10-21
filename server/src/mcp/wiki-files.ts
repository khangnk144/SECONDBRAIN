import type { VaultPath, VaultService, WriteResult } from '../vault/vault-types.js';
import { appendToFile, lineEndingOf, withLineEnding } from './vault-append.js';

export const WIKI_INDEX_PATH: VaultPath = 'wiki/index.md';
export const WIKI_LOG_PATH: VaultPath = 'wiki/log.md';
/** First line of a log the server has to create (sample data and the skeleton use the same). */
export const WIKI_LOG_HEADING = '# Nhật ký wiki';

/**
 * Appends one line to `wiki/log.md` (created with its heading when missing). Earlier bytes are
 * never rewritten: a missing final line break is added before the new line, never fixed inside.
 */
export function appendWikiLogLine(vault: VaultService, line: string): Promise<WriteResult> {
  return appendToFile(vault, WIKI_LOG_PATH, {
    initial: () => `${WIKI_LOG_HEADING}\n\n${line}\n`,
    addition: (current) => {
      const eol = lineEndingOf(current);
      const separator = current === '' || current.endsWith('\n') ? '' : eol;
      return `${separator}${line}${eol}`;
    },
  });
}

/** `text` as a new paragraph after `current`: exactly one blank line before it. */
export function paragraphAddition(current: string, text: string): string {
  const eol = lineEndingOf(current);
  const trailing = /(?:\r?\n)*$/.exec(current)?.[0] ?? '';
  const breaks = (trailing.match(/\n/g) ?? []).length;
  const separator = current === '' ? '' : eol.repeat(Math.max(0, 2 - breaks));
  return `${separator}${withLineEnding(text, eol)}${eol}`;
}

/**
 * One line of plain text (log lines, reasons): every kind of line break (also NEL U+0085, U+2028,
 * U+2029), control character (C0, C1) and run of blanks becomes one space.
 */
export function oneLine(text: string, maxCodePoints = 300): string {
  const flat = text
    .normalize('NFC')
    .replace(/[\s\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
    .trim();
  return Array.from(flat).slice(0, maxCodePoints).join('');
}
