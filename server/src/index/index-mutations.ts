/**
 * Applies file changes to the live index: reads happen first (async), then one transaction
 * writes rows and re-resolves the links that the path changes can affect, then the event log
 * receives the before/after differences of every touched note.
 */
import type Database from 'better-sqlite3';
import {
  isVaultError,
  type FileStat,
  type NoteRead,
  type VaultPath,
  type VaultService,
} from '../vault/vault-types.js';
import type { IndexEvent } from './event-log.js';
import { diffSnapshots, isLoggedNote, takeSnapshot, type NoteSnapshot } from './index-events.js';
import type { IndexWriter } from './index-writer.js';
import { notesLinkingByKeys, reresolveLinks } from './link-reresolve.js';
import { pathTargetKey, type PathCatalog } from './link-targets.js';
import { isIndexedAsNote, type NoteRecord } from './note-record.js';
import { buildRecordSafely } from './record-fallback.js';

export interface ChangeSet {
  /** Created or modified files (re-read; unchanged revisions are a no-op). */
  written?: VaultPath[];
  removed?: VaultPath[];
  renamed?: { from: VaultPath; to: VaultPath }[];
  /** Reads already done by the caller (reconcile's rename detection), keyed by path. */
  preloaded?: ReadonlyMap<VaultPath, NoteRead>;
  /** Link target keys to resolve again even though no path with that key changed. */
  reresolveKeys?: readonly string[];
}

export interface MutationContext {
  db: Database.Database;
  writer: IndexWriter;
  catalog: PathCatalog;
  vault: VaultService;
  now: () => Date;
  log: (events: IndexEvent[]) => void;
  warn: (message: string, details?: Record<string, unknown>) => void;
  /**
   * Before-state taken from the previous database for changes that waited for a rebuild
   * (`undefined` = none); each entry is handed out once.
   */
  takePriorSnapshot: (path: VaultPath) => NoteSnapshot | null | undefined;
}

type Loaded =
  { kind: 'note'; record: NoteRecord | null; read: NoteRead } | { kind: 'file'; stat: FileStat };

async function load(
  ctx: MutationContext,
  path: VaultPath,
  preloaded?: NoteRead,
): Promise<Loaded | null> {
  try {
    if (!isIndexedAsNote(path)) {
      const stat = await ctx.vault.stat(path);
      return stat ? { kind: 'file', stat } : null;
    }
    const read = preloaded ?? (await ctx.vault.read(path));
    const state = ctx.writer.noteState(path);
    // Same bytes as indexed: skip parsing; only size/mtime may need refreshing.
    const record =
      state?.revision === read.revision ? null : buildRecordSafely(path, read, ctx.warn);
    return { kind: 'note', record, read };
  } catch (error) {
    if (isVaultError(error) && (error.code === 'NOT_FOUND' || error.code === 'INVALID_PATH'))
      return null;
    throw error;
  }
}

export async function applyChanges(ctx: MutationContext, changes: ChangeSet): Promise<void> {
  const { catalog, writer, db } = ctx;
  const loaded = new Map<VaultPath, Loaded>();
  const removed = new Set<VaultPath>(changes.removed ?? []);
  const renames: { from: VaultPath; to: VaultPath }[] = [];
  const toLoad = new Set(changes.written ?? []);
  for (const r of changes.renamed ?? []) {
    if (r.from === r.to) continue;
    toLoad.add(r.to);
    // An old name the index never held (e.g. unreadable during a rebuild): delete + create.
    if (catalog.has(r.from)) renames.push(r);
    else removed.add(r.from);
  }
  for (const path of toLoad) {
    const item = await load(ctx, path, changes.preloaded?.get(path));
    if (item) loaded.set(path, item);
    else removed.add(path);
  }

  const added = [...loaded.keys()].filter((p) => !catalog.has(p));
  // Keys of every removed path count, indexed or not: a rebuild may have resolved links to a
  // file it listed but could no longer read, and only this re-resolution corrects them.
  const gone = [...removed, ...renames.map((r) => r.from)];
  const goneFromCatalog = gone.filter((p) => catalog.has(p));
  const keys = new Set([
    ...[...added, ...gone].map(pathTargetKey),
    ...(changes.reresolveKeys ?? []),
  ]);
  const renamedTo = new Map(renames.map((r) => [r.to, r.from]));
  const touched = new Set<VaultPath>([...removed, ...renames.map((r) => r.from), ...loaded.keys()]);
  for (const p of notesLinkingByKeys(db, keys)) touched.add(p);
  const before = new Map<VaultPath, NoteSnapshot | null>();
  for (const p of touched) {
    if (renamedTo.has(p)) continue;
    const prior = ctx.takePriorSnapshot(p);
    before.set(p, prior !== undefined ? prior : takeSnapshot(db, p));
  }

  for (const p of gone) catalog.delete(p);
  for (const p of added) catalog.add(p);
  const resolve = catalog.resolver();
  // Notes whose content changed while the index already had a row for them (`note_edited`).
  const edited = new Set<VaultPath>();

  const apply = db.transaction(() => {
    for (const p of removed) if (writer.deleteNote(p) === null) writer.deleteFile(p);
    const movedIds: number[] = [];
    for (const { from, to } of renames) {
      const id = writer.noteId(from);
      if (id !== null && isIndexedAsNote(to) && loaded.has(to)) {
        // An outside tool may have renamed onto an existing file: that row is replaced.
        if (writer.noteId(to) !== null) writer.deleteNote(to);
        writer.moveNote(id, to);
        movedIds.push(id);
      } else {
        // A renamed PDF keeps its extracted text (the content did not change).
        if (loaded.get(to)?.kind === 'file') writer.sources.move(from, to);
        if (writer.deleteNote(from) === null) writer.deleteFile(from);
      }
    }
    for (const [path, item] of loaded) {
      if (item.kind === 'file') {
        writer.writeFile(item.stat);
        continue;
      }
      const { read } = item;
      const state = writer.noteState(path);
      if (state?.revision === read.revision) {
        if (state.mtime !== Math.trunc(read.mtimeMs) || state.size !== read.size)
          writer.touchNote(state.id, read.mtimeMs, read.size);
        continue;
      }
      if (state && isLoggedNote(path)) edited.add(path);
      // The row may differ from what load() compared against (a rename moved another row here).
      writer.writeNote(item.record ?? buildRecordSafely(path, read, ctx.warn), resolve);
    }
    reresolveLinks(db, resolve, { keys, fromIds: movedIds });
  });
  try {
    apply();
  } catch (error) {
    // Rolled back: the catalog must describe the rows that are still there.
    for (const p of added) catalog.delete(p);
    for (const p of goneFromCatalog) catalog.add(p);
    throw error;
  }

  const ts = ctx.now().toISOString();
  const events: IndexEvent[] = [];
  const renamedFrom = new Set(renames.map((r) => r.from));
  // The event log keeps one `note_edited` per note and day; a note created now has none.
  const editOf = (p: VaultPath, existed: boolean): IndexEvent[] =>
    existed && edited.has(p) ? [{ ts, event: 'note_edited', path: p }] : [];
  for (const { from, to } of renames) {
    const prior = before.get(from) ?? null;
    events.push(...diffSnapshots(ts, prior, takeSnapshot(db, to), from), ...editOf(to, !!prior));
  }
  for (const [p, snapshot] of before)
    if (!renamedFrom.has(p))
      events.push(...diffSnapshots(ts, snapshot, takeSnapshot(db, p)), ...editOf(p, !!snapshot));
  ctx.log(events);
}
