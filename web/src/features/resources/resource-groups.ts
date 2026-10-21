/**
 * The "Tài liệu" list, grouped by where files live: `3 Resources/papers`, `slides`, `web`,
 * `other` (then any folder she made there), then `Attachments/<month>` newest first. A file deeper
 * than its group keeps the rest of its folder as a hint.
 */
import type { ResourceFile } from '../../lib/api/resources-types';
import { foldText } from '../../lib/fold-text';

export interface ResourceGroup {
  /** Folder path of the group, as spelled on disk (`3 Resources/papers`, `Attachments/2026-10`). */
  key: string;
  files: ResourceEntry[];
}

export interface ResourceEntry {
  file: ResourceFile;
  /** Folders between the group and the file (`ML/2025`), or ''. */
  subfolder: string;
}

const RESOURCE_ORDER = ['papers', 'slides', 'web', 'other'];

function splitGroup(path: string): { key: string; subfolder: string } {
  const parts = path.split('/');
  parts.pop();
  if (parts.length <= 1) return { key: parts[0] ?? '', subfolder: '' };
  return { key: parts.slice(0, 2).join('/'), subfolder: parts.slice(2).join('/') };
}

/** Sort rank of a group key; ties are broken by `compareKeys`. */
function rank(key: string): number {
  const [top = '', sub] = key.toLowerCase().split('/');
  if (top === '3 resources') {
    if (sub === undefined) return 5;
    const known = RESOURCE_ORDER.indexOf(sub);
    return known === -1 ? 4 : known;
  }
  if (top === 'attachments') return sub === undefined ? 7 : 6;
  return 8;
}

const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

function compareKeys(a: string, b: string): number {
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  // Months (`Attachments/2026-10`) newest first; everything else alphabetically.
  return rank(a) === 6 ? collator.compare(b, a) : collator.compare(a, b);
}

/** Every whitespace-separated word of the filter must appear in the name or its subfolder. */
export function matchesFilter(entry: ResourceEntry, filter: string): boolean {
  const words = foldText(filter).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldText(`${entry.file.name} ${entry.subfolder}`);
  return words.every((word) => haystack.includes(word));
}

export function groupResources(files: readonly ResourceFile[], filter = ''): ResourceGroup[] {
  const groups = new Map<string, ResourceGroup>();
  for (const file of files) {
    const { key, subfolder } = splitGroup(file.path);
    const entry = { file, subfolder };
    if (!matchesFilter(entry, filter)) continue;
    // Windows sees `papers` and `Papers` as one folder: so does the list.
    const id = key.normalize('NFC').toLowerCase();
    const group = groups.get(id) ?? { key, files: [] };
    group.files.push(entry);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => compareKeys(a.key, b.key));
}
