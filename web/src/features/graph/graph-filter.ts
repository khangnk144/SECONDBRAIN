/**
 * The brain map's filters (SPEC F24.2), mirrored by hand from `server/src/graph/graph-filter.ts`
 * (the predicate `GET /api/graph?folder=&tag=&since=` uses): keep both in step, the parity test
 * (`graph-filter-parity.test.ts`) runs them on the same nodes. The map dims what does not match.
 *
 * Rules:
 * - Folder: the node's top folder is one of `folders` (compared NFC + lowercase, as Windows sees
 *   folder names) or its colour group is one of `groups`. Both empty: every node passes.
 * - Tag: the node carries the tag or a nested one (`môn` matches `môn/giải-tích`), compared in the
 *   §4.14 normalized form (NFC, lowercase, `đ`→`d`); a leading `#` is ignored.
 * - Time: the note was created or edited at or after `since` (epoch ms). Sources (PDFs,
 *   attachments) have no edit time, so they never match a time filter.
 * The three dimensions combine with AND.
 */

export type GraphFilterGroup = 'projects' | 'areas' | 'resources' | 'wiki' | 'daily' | 'other';

export interface GraphFilter {
  /** Top folder names (`1 Projects`, `Daily`, `0 Inbox`; '' = the vault root). */
  folders: readonly string[];
  /** Colour groups (the legend's chips). */
  groups: readonly GraphFilterGroup[];
  /** One tag, any spelling; null = no tag filter. */
  tag: string | null;
  /** Created or edited at or after this instant (epoch ms); null = any time. */
  since: number | null;
}

/** What the predicate reads of a node. */
export interface GraphFilterFacts {
  id: string;
  group: string;
  kind: 'note' | 'source';
  /** Tags in normalized form (`normalizeGraphTag`). */
  tags?: readonly string[];
  /** Last modification of the file (epoch ms). */
  mtimeMs?: number | null;
  /** First seen by the event log (exact history only, epoch ms). */
  createdMs?: number | null;
}

export const EMPTY_GRAPH_FILTER: GraphFilter = { folders: [], groups: [], tag: null, since: null };

/** §4.14 normalization of a tag (SPEC: NFC → lowercase → `đ`→`d`), without a leading `#`. */
export function normalizeGraphTag(tag: string): string {
  return tag.trim().replace(/^#/, '').normalize('NFC').toLowerCase().replaceAll('đ', 'd');
}

function folderKey(folder: string): string {
  return folder.trim().replace(/\/+$/, '').normalize('NFC').toLowerCase();
}

function topFolder(id: string): string {
  const slash = id.indexOf('/');
  return slash === -1 ? '' : id.slice(0, slash);
}

export function isGraphFilterActive(filter: GraphFilter): boolean {
  return (
    filter.folders.length > 0 ||
    filter.groups.length > 0 ||
    (filter.tag !== null && normalizeGraphTag(filter.tag) !== '') ||
    filter.since !== null
  );
}

/** The latest instant a node was touched (created or edited), or null for sources. */
export function touchedAt(node: GraphFilterFacts): number | null {
  if (node.kind !== 'note') return null;
  const values = [node.mtimeMs, node.createdMs].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  return values.length === 0 ? null : Math.max(...values);
}

/** Compiles the filter once (normalization), then tests nodes cheaply. */
export function graphFilterPredicate(filter: GraphFilter): (node: GraphFilterFacts) => boolean {
  const folders = new Set(filter.folders.map(folderKey));
  const groups = new Set<string>(filter.groups);
  const tag = filter.tag === null ? '' : normalizeGraphTag(filter.tag);
  const nested = `${tag}/`;
  const since = filter.since;
  const byFolder = folders.size > 0 || groups.size > 0;
  return (node) => {
    if (byFolder && !folders.has(folderKey(topFolder(node.id))) && !groups.has(node.group)) {
      return false;
    }
    if (tag !== '' && !(node.tags ?? []).some((t) => t === tag || t.startsWith(nested))) {
      return false;
    }
    if (since !== null) {
      const touched = touchedAt(node);
      if (touched === null || touched < since) return false;
    }
    return true;
  };
}

/** Ids of the nodes that match, in input order. */
export function graphFilterMatches(
  filter: GraphFilter,
  nodes: readonly GraphFilterFacts[],
): string[] {
  const test = graphFilterPredicate(filter);
  return nodes.filter(test).map((node) => node.id);
}
