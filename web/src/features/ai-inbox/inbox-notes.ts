/** The notes directly in `0 Inbox` and the first line that tells them apart. */
import type { TreeFolder, VaultTree } from '../../lib/api/tree-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { INBOX_FOLDER, isNotePath, noteTitleFromPath, pathKey } from '../../lib/vault-paths';

export interface InboxNote {
  path: VaultPath;
  title: string;
}

const INBOX_KEY = pathKey(INBOX_FOLDER);
/** A note path inside the Inbox, to ask whether Inbox notes are in the AI scope. */
export const INBOX_PROBE_PATH = `${INBOX_FOLDER}/_.md`;
const FIRST_LINE_CHARS = 120;

/** `0 Inbox/<name>.md` (any case of the folder name), not its subfolders (same rule as the server). */
export function isDirectlyInInbox(path: VaultPath): boolean {
  const segments = path.split('/');
  return segments.length === 2 && pathKey(segments[0]!) === INBOX_KEY && isNotePath(path);
}

/** Notes of the Inbox in the tree's order (by title). */
export function inboxNotesOf(tree: VaultTree): InboxNote[] {
  const inbox: TreeFolder | undefined = tree.root.folders.find(
    (f) => pathKey(f.path) === INBOX_KEY,
  );
  return (inbox?.files ?? [])
    .filter((file) => file.isNote)
    .map((file) => ({ path: file.path, title: noteTitleFromPath(file.path) }));
}

/**
 * First non-empty body line, without front matter and Markdown line marks, skipping a line that
 * only repeats the title (a template heading); '' when there is none.
 */
export function firstLine(content: string, title = ''): string {
  const titleKey = title.normalize('NFC').toLowerCase();
  const lines = content.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end !== -1) start = end + 1;
  }
  for (const line of lines.slice(start)) {
    const text = line
      .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)*/, '')
      .trim();
    if (text === '' || text.normalize('NFC').toLowerCase() === titleKey) continue;
    return [...text].slice(0, FIRST_LINE_CHARS).join('');
  }
  return '';
}
