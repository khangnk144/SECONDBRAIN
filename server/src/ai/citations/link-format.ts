/**
 * How answers link to notes and sources (SPEC §4.4): always the path form, which resolves to
 * exactly one file whatever titles exist elsewhere. A name containing characters that cannot be
 * written inside `[[…]]` (`[ ] | # ^`, line breaks) is written as plain text instead.
 */
import { noteTitleFromPath } from '../../markdown/content-classes.js';
import type { VaultPath } from '../../vault/vault-types.js';

const UNLINKABLE = /[[\]|#^\r\n]/;

export function canLink(...parts: string[]): boolean {
  return parts.every((part) => !UNLINKABLE.test(part));
}

/** `[[1 Projects/Đồ án|Đồ án]]` (path without `.md`, the title as alias). */
export function noteLink(path: VaultPath, title: string): string {
  const target = path.replace(/\.md$/i, '');
  return canLink(target, title) ? `[[${target}|${title}]]` : title;
}

/** `[[bài báo.pdf]] (tr. 3)`; the path form when the file name alone is not unique. */
export function sourceFileLink(
  path: VaultPath,
  page: number | null,
  uniqueName: boolean,
  language: 'vi' | 'en',
): string {
  const name = noteTitleFromPath(path);
  const target = uniqueName ? name : path;
  const link = canLink(target) ? `[[${target}]]` : name;
  if (page === null) return link;
  return `${link} (${language === 'vi' ? 'tr.' : 'p.'} ${page})`;
}
