/**
 * The "Tài liệu" view (SPEC F15): every file under `3 Resources/` and `Attachments/` with the notes
 * that reference it. References come from the index's resolved links (wikilinks, embeds and
 * Markdown links; ambiguous and ghost links resolve to nothing), so no file is read per request.
 */
import { noteTitleFromPath, topFolderOfPath } from '../markdown/content-classes.js';
import type { GraphRows } from '../index/view-row-queries.js';
import type { VaultPath } from '../vault/vault-types.js';
import { fileKindOf, type FileKind } from './attachment-kinds.js';

export interface ResourceReference {
  path: VaultPath;
  title: string;
}

export interface ResourceFile {
  path: VaultPath;
  /** File name with extension. */
  name: string;
  /** Parent folder path, e.g. `3 Resources/papers` or `Attachments/2026-10`. */
  folder: string;
  kind: FileKind;
  size: number;
  /** Last modification, epoch milliseconds. */
  mtime: number;
  referencedBy: ResourceReference[];
}

export interface FileFacts {
  size: number;
  mtimeMs: number;
}

const RESOURCE_TOP_FOLDERS = new Set(['3 resources', 'attachments']);
const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

/** Under `3 Resources/` or `Attachments/` (any case, as Windows sees folders). */
export function isResourcePath(path: VaultPath): boolean {
  return RESOURCE_TOP_FOLDERS.has(topFolderOfPath(path).normalize('NFC').toLowerCase());
}

const parentOf = (path: VaultPath) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));
const nameOf = (path: VaultPath) => path.slice(path.lastIndexOf('/') + 1);

const byTitleThenPath = (a: ResourceReference, b: ResourceReference) =>
  collator.compare(a.title, b.title) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** Resource paths of the index rows (notes in those folders included as `note`). */
export function resourcePaths(rows: GraphRows): VaultPath[] {
  return [...rows.notes.map((note) => note.path), ...rows.files].filter(isResourcePath);
}

/**
 * Builds the listing; `facts` holds size and mtime of each path still on disk (a path missing
 * from it vanished meanwhile and is left out). Sorted by folder, then name (Vietnamese order).
 */
export function buildResourceListing(
  rows: GraphRows,
  facts: ReadonlyMap<VaultPath, FileFacts>,
): ResourceFile[] {
  const paths = resourcePaths(rows);
  const references = new Map<VaultPath, ResourceReference[]>(paths.map((path) => [path, []]));
  let titles: Map<VaultPath, string> | null = null;
  for (const { from, to } of rows.links) {
    const list = from === to ? undefined : references.get(to);
    if (!list) continue;
    titles ??= new Map(rows.notes.map((note) => [note.path, note.title]));
    list.push({ path: from, title: titles.get(from) ?? noteTitleFromPath(from) });
  }
  const files: ResourceFile[] = [];
  for (const path of paths) {
    const fact = facts.get(path);
    if (!fact) continue;
    files.push({
      path,
      name: nameOf(path),
      folder: parentOf(path),
      kind: fileKindOf(path),
      size: fact.size,
      mtime: fact.mtimeMs,
      referencedBy: references.get(path)!.sort(byTitleThenPath),
    });
  }
  return files.sort(
    (a, b) =>
      collator.compare(a.folder, b.folder) ||
      collator.compare(a.name, b.name) ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
}
