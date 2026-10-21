/**
 * Builds a complete index into a fresh database file from the vault listing. The link catalog
 * comes from the listing, so each link resolves on insert. A note deleted or renamed after the
 * listing cannot be read: links that resolved to it are resolved again at the end against the
 * paths that really made it in, so the new index never points at a file it does not hold.
 * Reads of the next batch overlap with parsing the current one.
 */
import type Database from 'better-sqlite3';
import {
  isVaultError,
  type NoteRead,
  type VaultPath,
  type VaultService,
} from '../vault/vault-types.js';
import { createBuildDatabase, removeDatabaseFiles } from './index-database.js';
import type { RebuildProgress } from './index-types.js';
import { createIndexWriter } from './index-writer.js';
import { reresolveLinks } from './link-reresolve.js';
import { PathCatalog, pathTargetKey } from './link-targets.js';
import { isIndexedAsNote } from './note-record.js';
import { buildRecordSafely } from './record-fallback.js';
import { keepsSourceText } from './source-text-rows.js';
import { cachedTextForFiles, indexablePages } from '../sources/source-cache.js';

const BATCH = 64;

export interface BuildOptions {
  vault: VaultService;
  file: string;
  onProgress: (progress: RebuildProgress) => void;
  /** Checked between batches; a closed service abandons the build. */
  isCancelled: () => boolean;
  warn: (message: string, details?: Record<string, unknown>) => void;
}

export interface BuildResult {
  /** Every path that made it into the new index (notes and other files). */
  paths: VaultPath[];
  /** Notes as `{ path, created, mtimeMs }` for the approximate first-index history. */
  notes: { path: VaultPath; created: string | null; mtimeMs: number }[];
}

export class BuildCancelledError extends Error {
  constructor() {
    super('Index build cancelled');
  }
}

async function readOrSkip(vault: VaultService, path: VaultPath): Promise<NoteRead | null> {
  try {
    return await vault.read(path);
  } catch (error) {
    // Deleted between the listing and the read: the watcher reports the deletion separately.
    if (isVaultError(error) && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

function finish(db: Database.Database): void {
  // Links inserted before their target note existed got no to_id; fill them in one pass.
  db.exec(`UPDATE links SET to_id = (SELECT id FROM notes WHERE path = links.to_path)
    WHERE to_path IS NOT NULL AND to_id IS NULL`);
  db.exec("INSERT INTO notes_fts(notes_fts) VALUES ('optimize')");
  db.exec("INSERT INTO sources_fts(sources_fts) VALUES ('optimize')");
  db.exec('ANALYZE');
}

export async function buildIndexFile(options: BuildOptions): Promise<BuildResult> {
  const { vault, onProgress } = options;
  onProgress({ phase: 'scan', done: 0, total: 0 });
  const listing = await vault.list();
  const db = createBuildDatabase(options.file);
  try {
    const total = listing.files.length;
    const catalog = new PathCatalog(listing.files.map((f) => f.path));
    const resolve = catalog.resolver();
    const writer = createIndexWriter(db);
    const others = listing.files.filter((f) => !isIndexedAsNote(f.path));
    const notePaths = listing.files.filter((f) => isIndexedAsNote(f.path)).map((f) => f.path);
    db.transaction(() => others.forEach((stat) => writer.writeFile(stat)))();
    // PDF page text comes back from the sources cache (never extracted here, F30.4).
    const pdfs = others.filter((stat) => keepsSourceText(stat.path));
    const cached = pdfs.length > 0 ? await cachedTextForFiles(vault.paths.cacheDir, pdfs) : null;
    db.transaction(() => {
      for (const [path, { contentHash, entry }] of cached ?? [])
        writer.sources.write(path, contentHash, indexablePages(entry));
    })();
    const result: BuildResult = { paths: others.map((f) => f.path), notes: [] };
    const unreadable: VaultPath[] = [];
    let done = others.length;
    onProgress({ phase: 'index', done, total });

    const readBatch = (i: number) => {
      const batch = Promise.all(notePaths.slice(i, i + BATCH).map((p) => readOrSkip(vault, p)));
      // Marked as handled: a batch read ahead is abandoned when the build stops early.
      batch.catch(() => undefined);
      return batch;
    };
    let pending = readBatch(0);
    for (let i = 0; i < notePaths.length; i += BATCH) {
      const reads = await pending;
      if (options.isCancelled()) throw new BuildCancelledError();
      if (i + BATCH < notePaths.length) pending = readBatch(i + BATCH);
      db.transaction(() => {
        reads.forEach((read, k) => {
          const path = notePaths[i + k] as VaultPath;
          if (!read) {
            unreadable.push(path);
            return;
          }
          const record = buildRecordSafely(path, read, options.warn);
          writer.writeNote(record, resolve);
          result.paths.push(path);
          result.notes.push({ path, created: record.created, mtimeMs: record.mtimeMs });
        });
      })();
      done += reads.length;
      onProgress({ phase: 'index', done, total });
    }
    if (unreadable.length > 0) {
      const actual = new PathCatalog(result.paths).resolver();
      db.transaction(() => reresolveLinks(db, actual, { keys: unreadable.map(pathTargetKey) }))();
    }
    finish(db);
    db.close();
    return result;
  } catch (error) {
    db.close();
    removeDatabaseFiles(options.file);
    throw error;
  }
}
