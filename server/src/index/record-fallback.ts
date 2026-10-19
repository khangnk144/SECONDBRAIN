/**
 * A note the parser cannot handle must still be findable: it is indexed with its raw text and
 * no links, tags or tasks, and a warning names the path (never the content).
 */
import { CLASS_RULES, classifyPath } from '../markdown/content-classes.js';
import { normalizeForIndex } from '../markdown/normalize-text.js';
import type { NoteRead, VaultPath } from '../vault/vault-types.js';
import { countWords } from './html-text.js';
import { buildNoteRecord, folderOf, titleForPath, type NoteRecord } from './note-record.js';

export function buildRecordSafely(
  path: VaultPath,
  read: NoteRead,
  warn: (message: string, details?: Record<string, unknown>) => void,
): NoteRecord {
  try {
    return buildNoteRecord(path, read);
  } catch (error) {
    warn('index: note could not be parsed, indexed as plain text', {
      path,
      error: (error as Error).message,
    });
    const title = titleForPath(path);
    const cls = classifyPath(path);
    return {
      path,
      title,
      titleNorm: normalizeForIndex(title),
      pathNorm: normalizeForIndex(path),
      folder: folderOf(path),
      cls,
      searchable: CLASS_RULES[cls].searchable,
      type: null,
      status: null,
      deadline: null,
      created: null,
      mtimeMs: Math.trunc(read.mtimeMs),
      size: read.size,
      revision: read.revision,
      frontmatterJson: null,
      frontmatterError: null,
      wordCount: countWords(read.content),
      plain: read.content,
      links: [],
      tags: [],
      tasks: [],
    };
  }
}
