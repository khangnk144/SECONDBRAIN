/**
 * Lookup structure for link resolution (SPEC §4.4, §4.8). Built once from every file path in the
 * vault; immutable afterwards. All keys go through `linkIdentityKey` (NFC + lowercase), so
 * lookups are case-insensitive and NFC/NFD-insensitive like Windows file names.
 */
import type { VaultPath } from '../vault/vault-types.js';
import { classifyPath, isNotePath, noteTitleFromPath } from './content-classes.js';
import type { LinkCatalog } from './markdown-types.js';
import { linkIdentityKey } from './normalize-text.js';

/** Internal maps of a catalog; each value lists every path with that key, sorted. */
export interface CatalogIndex {
  /** Note titles, excluding templates (path form still reaches them). */
  byTitle: ReadonlyMap<string, readonly VaultPath[]>;
  /** Note paths without `.md`. */
  byNotePath: ReadonlyMap<string, readonly VaultPath[]>;
  /** Full paths of every file (notes with their `.md`, attachments, sources). */
  byFilePath: ReadonlyMap<string, readonly VaultPath[]>;
  /** File names (with extension) of non-note files. */
  byFileName: ReadonlyMap<string, readonly VaultPath[]>;
}

// Keyed by the catalog object so a plain `{ notePaths, filePaths }` built elsewhere (for example
// a test double) still resolves: its index is derived lazily on first use.
const indexes = new WeakMap<LinkCatalog, CatalogIndex>();

export function buildLinkCatalog(paths: Iterable<VaultPath>): LinkCatalog {
  const notePaths = new Set<VaultPath>();
  const filePaths = new Set<VaultPath>();
  for (const path of paths) (isNotePath(path) ? notePaths : filePaths).add(path);
  const catalog: LinkCatalog = Object.freeze({ notePaths, filePaths });
  indexes.set(catalog, buildIndex(notePaths, filePaths));
  return catalog;
}

export function catalogIndex(catalog: LinkCatalog): CatalogIndex {
  let index = indexes.get(catalog);
  if (!index) {
    index = buildIndex(catalog.notePaths, catalog.filePaths);
    indexes.set(catalog, index);
  }
  return index;
}

function buildIndex(
  notePaths: ReadonlySet<VaultPath>,
  filePaths: ReadonlySet<VaultPath>,
): CatalogIndex {
  const byTitle = new Map<string, VaultPath[]>();
  const byNotePath = new Map<string, VaultPath[]>();
  const byFilePath = new Map<string, VaultPath[]>();
  const byFileName = new Map<string, VaultPath[]>();
  for (const path of notePaths) {
    if (classifyPath(path) !== 'template') add(byTitle, noteTitleFromPath(path), path);
    add(byNotePath, path.slice(0, -3), path);
    add(byFilePath, path, path);
  }
  for (const path of filePaths) {
    add(byFilePath, path, path);
    add(byFileName, path.slice(path.lastIndexOf('/') + 1), path);
  }
  for (const map of [byTitle, byNotePath, byFilePath, byFileName]) {
    for (const list of map.values()) list.sort();
  }
  return { byTitle, byNotePath, byFilePath, byFileName };
}

function add(map: Map<string, VaultPath[]>, key: string, path: VaultPath): void {
  const norm = linkIdentityKey(key);
  const list = map.get(norm);
  if (list) list.push(path);
  else map.set(norm, [path]);
}
