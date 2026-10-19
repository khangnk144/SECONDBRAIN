/**
 * "Nhắc đến chưa liên kết" (SPEC F5): other notes that mention a note's title as plain text.
 * Candidates come from the full-text index (the title's words in sequence), then each candidate
 * is read from disk and scanned exactly, so offsets match the revision the client gets.
 */
import type { IndexService } from '../index/index-types.js';
import { isNotePath, noteTitleFromPath } from '../markdown/content-classes.js';
import { lineContext } from '../markdown/line-context.js';
import { findTitleMentions } from '../markdown/title-mentions.js';
import { isVaultError, type VaultPath, type VaultService } from '../vault/vault-types.js';

/** At most this many mentions are listed (first by path, then by position). */
export const MAX_MENTIONS = 100;

export interface UnlinkedMention {
  /** The mentioning note. */
  path: VaultPath;
  title: string;
  /** Revision of the mentioning note the offsets refer to. */
  revision: string;
  /** 1-based line of the mention. */
  line: number;
  /** The line around the mention (≤ 160 characters) and the mention's place in it. */
  context: string;
  highlight: [number, number];
  /** UTF-16 offsets of the mention in the mentioning note's content at `revision`. */
  start: number;
  end: number;
}

function lineOf(content: string, offset: number): number {
  let line = 1;
  let at = content.indexOf('\n');
  while (at !== -1 && at < offset) {
    line += 1;
    at = content.indexOf('\n', at + 1);
  }
  return line;
}

export async function findUnlinkedMentions(
  deps: { vault: VaultService; index: IndexService },
  notePath: VaultPath,
): Promise<UnlinkedMention[]> {
  const title = noteTitleFromPath(notePath);
  const key = notePath.normalize('NFC').toLowerCase();
  const mentions: UnlinkedMention[] = [];
  for (const candidate of deps.index.notesContainingPhrase(title)) {
    if (!isNotePath(candidate) || candidate.normalize('NFC').toLowerCase() === key) continue;
    let note;
    try {
      note = await deps.vault.read(candidate);
    } catch (error) {
      // Deleted or renamed since it was indexed: nothing to list.
      if (isVaultError(error) && (error.code === 'NOT_FOUND' || error.code === 'INVALID_PATH')) {
        continue;
      }
      throw error;
    }
    // A note that is not UTF-8 can never be patched, so offering "Liên kết" there would fail.
    if (!note.utf8) continue;
    for (const { start, end } of findTitleMentions(note.content, title)) {
      mentions.push({
        path: note.path,
        title: noteTitleFromPath(note.path),
        revision: note.revision,
        line: lineOf(note.content, start),
        ...lineContext(note.content, start, end),
        start,
        end,
      });
      if (mentions.length === MAX_MENTIONS) return mentions;
    }
  }
  return mentions;
}
