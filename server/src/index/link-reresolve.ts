/**
 * Re-resolves stored links after the set of paths changed, so a ghost link becomes resolved
 * the moment its target appears and a unique title becomes ambiguous when a duplicate appears.
 */
import type Database from 'better-sqlite3';
import type { VaultPath } from '../vault/vault-types.js';
import type { LinkResolver } from './link-targets.js';

/** SQLite's default limit on bound parameters is far above this; chunks keep statements small. */
const CHUNK = 400;

function chunks<T>(values: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += CHUNK) out.push(values.slice(i, i + CHUNK));
  return out;
}

interface StoredLink {
  rowid: number;
  kind: 'wikilink' | 'embed' | 'markdown';
  target: string;
  fromPath: VaultPath;
  toPath: VaultPath | null;
  ambiguous: number;
}

const LINK_COLUMNS = `l.rowid AS rowid, l.kind AS kind, l.target_raw AS target, n.path AS fromPath,
  l.to_path AS toPath, l.ambiguous AS ambiguous`;

/** Paths of notes holding at least one link stored under one of `keys`. */
export function notesLinkingByKeys(db: Database.Database, keys: Iterable<string>): VaultPath[] {
  const out = new Set<VaultPath>();
  for (const part of chunks([...new Set(keys)])) {
    const sql = `SELECT DISTINCT n.path FROM links l JOIN notes n ON n.id = l.from_id
      WHERE l.target_key IN (${part.map(() => '?').join(',')})`;
    for (const p of db
      .prepare(sql)
      .pluck()
      .all(...part) as VaultPath[])
      out.add(p);
  }
  return [...out];
}

/**
 * Resolves again the links stored under `keys` and every link of the notes `fromIds` (notes that
 * moved: same-folder preference and relative Markdown links depend on where the link lives).
 * Must run inside the caller's transaction, after the catalog reflects the new path set.
 */
export function reresolveLinks(
  db: Database.Database,
  resolve: LinkResolver,
  scope: { keys: Iterable<string>; fromIds?: readonly number[] },
): number {
  const update = db.prepare(
    `UPDATE links SET to_path = ?, to_id = (SELECT id FROM notes WHERE path = ?), ambiguous = ?
     WHERE rowid = ?`,
  );
  const seen = new Set<number>();
  let changed = 0;
  const apply = (links: StoredLink[]) => {
    for (const link of links) {
      if (seen.has(link.rowid)) continue;
      seen.add(link.rowid);
      const next = resolve({ kind: link.kind, target: link.target }, link.fromPath);
      const ambiguous = next.ambiguous ? 1 : 0;
      if (next.toPath === link.toPath && ambiguous === link.ambiguous) continue;
      update.run(next.toPath, next.toPath, ambiguous, link.rowid);
      changed += 1;
    }
  };
  for (const part of chunks([...new Set(scope.keys)])) {
    const sql = `SELECT ${LINK_COLUMNS} FROM links l JOIN notes n ON n.id = l.from_id
      WHERE l.target_key IN (${part.map(() => '?').join(',')})`;
    apply(db.prepare(sql).all(...part) as StoredLink[]);
  }
  for (const part of chunks([...(scope.fromIds ?? [])])) {
    const sql = `SELECT ${LINK_COLUMNS} FROM links l JOIN notes n ON n.id = l.from_id
      WHERE l.from_id IN (${part.map(() => '?').join(',')})`;
    apply(db.prepare(sql).all(...part) as StoredLink[]);
  }
  return changed;
}

/**
 * Keys of links that claim to resolve to a path the index does not hold. Normally there are
 * none; reconcile uses this to repair an index damaged before a fix or by an interrupted update.
 */
export function danglingLinkKeys(db: Database.Database): string[] {
  return db
    .prepare(
      `SELECT DISTINCT l.target_key FROM links l
       WHERE l.to_path IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.path = l.to_path)
         AND NOT EXISTS (SELECT 1 FROM files f WHERE f.path = l.to_path)`,
    )
    .pluck()
    .all() as string[];
}
