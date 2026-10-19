/**
 * Opening and validating the live index file, and creating the file a rebuild writes into
 * (the swap itself is in database-swap.ts).
 */
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  INDEX_SCHEMA_VERSION,
  applyBuildPragmas,
  applyLivePragmas,
  createSchema,
  readSchemaVersion,
} from './index-schema.js';
import { removeDatabaseFilesSync } from './sync-file-retry.js';

export type RebuildReason = 'missing' | 'corrupt' | 'schema';

export type LiveOpenResult = { db: Database.Database } | { reason: RebuildReason };

export const buildingFileOf = (file: string): string => `${file}.building`;

/** Deletes a database file and its side files, retrying on Windows sharing violations. */
export function removeDatabaseFiles(file: string): void {
  removeDatabaseFilesSync(file);
}

function closeQuietly(db: Database.Database | null): void {
  try {
    db?.close();
  } catch {
    // Already closed or unusable: nothing left to release.
  }
}

/**
 * Every table of the schema, FTS shadow tables included. Checking them one by one covers the same
 * b-trees as a whole-file `quick_check` at a tenth of its cost on a 5k-note index (~0.1 s instead
 * of ~1 s at every start), and a missing table fails the check too.
 */
const CHECKED_TABLES = [
  'meta',
  'notes',
  'links',
  'tags',
  'tasks',
  'files',
  'note_text',
  'notes_fts_data',
  'notes_fts_idx',
  'notes_fts_content',
  'notes_fts_docsize',
  'notes_fts_config',
];

function passesQuickCheck(db: Database.Database): boolean {
  return CHECKED_TABLES.every((t) => db.pragma(`quick_check(${t})`, { simple: true }) === 'ok');
}

/** Opens the live index when it exists, passes `quick_check` and has our schema version. */
export function openLiveDatabase(file: string): LiveOpenResult {
  if (!existsSync(file)) return { reason: 'missing' };
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { fileMustExist: true });
    if (!passesQuickCheck(db)) {
      closeQuietly(db);
      return { reason: 'corrupt' };
    }
    if (readSchemaVersion(db) !== INDEX_SCHEMA_VERSION) {
      closeQuietly(db);
      return { reason: 'schema' };
    }
    applyLivePragmas(db);
    return { db };
  } catch {
    // "file is not a database", a missing meta table, an unreadable page: all mean rebuild.
    closeQuietly(db);
    return { reason: 'corrupt' };
  }
}

/** A fresh, empty database file for a rebuild (any leftover from a crashed build is removed). */
export function createBuildDatabase(file: string): Database.Database {
  removeDatabaseFiles(file);
  const db = new Database(file);
  applyBuildPragmas(db);
  createSchema(db);
  return db;
}
