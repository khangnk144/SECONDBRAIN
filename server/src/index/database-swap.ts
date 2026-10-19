/**
 * Puts a freshly built index file in place of the live one. Windows cannot rename over an open
 * file and antivirus or indexers may hold a file for a moment, so every rename and delete retries
 * briefly. The previous file is kept as `<live>.previous` until the new one has opened: if the
 * new file cannot be opened, the previous index comes back and queries keep working.
 *
 * Synchronous on purpose: between closing the old connection and opening the new one no query
 * may run, and a synchronous swap leaves the event loop no chance to schedule one.
 */
import { existsSync, renameSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openLiveDatabase } from './index-database.js';
import { applyLivePragmas } from './index-schema.js';
import {
  removeDatabaseFilesSync,
  removeSideFilesSync,
  retryTransientSync,
} from './sync-file-retry.js';

function closeQuietly(db: Database.Database | null): void {
  try {
    db?.close();
  } catch {
    // Already closed or unusable: nothing left to release.
  }
}

/** Test-only: lets a test make the open of the swapped-in file fail. */
export interface SwapFaults {
  beforeOpenSwapped?: (file: string) => void;
}

export type SwapResult =
  | { swapped: true; db: Database.Database }
  /** Not swapped; `db` is the previous index, reopened, or null when there was none. */
  | { swapped: false; db: Database.Database | null; error: Error };

function openSwapped(file: string, faults: SwapFaults): Database.Database {
  faults.beforeOpenSwapped?.(file);
  const db = new Database(file, { fileMustExist: true });
  try {
    applyLivePragmas(db);
    return db;
  } catch (error) {
    closeQuietly(db);
    throw error;
  }
}

/**
 * Puts `<live>.previous` back as the live file and opens it if it is still a good index. After a
 * failed open (`discardLive`), a live file that is not a usable index is deleted, so the next
 * start rebuilds instead of tripping over it.
 */
function restorePrevious(
  liveFile: string,
  previous: string,
  discardLive: boolean,
): Database.Database | null {
  try {
    if (existsSync(previous)) {
      removeDatabaseFilesSync(liveFile);
      retryTransientSync(() => renameSync(previous, liveFile));
    } else if (discardLive) {
      removeDatabaseFilesSync(liveFile);
    }
    if (!existsSync(liveFile)) return null;
    const reopened = openLiveDatabase(liveFile);
    if ('db' in reopened) return reopened.db;
    // The previous file was no good either (a corrupt index being replaced): start clean.
    if (discardLive) removeDatabaseFilesSync(liveFile);
    return null;
  } catch {
    return null;
  }
}

/** Replaces `liveFile` with `buildFile` and opens it; `current` (the old connection) is closed. */
export function swapDatabase(
  buildFile: string,
  liveFile: string,
  current: Database.Database | null,
  faults: SwapFaults = {},
): SwapResult {
  const previous = `${liveFile}.previous`;
  closeQuietly(current);
  try {
    removeDatabaseFilesSync(previous);
    removeSideFilesSync(liveFile);
    if (existsSync(liveFile)) retryTransientSync(() => renameSync(liveFile, previous));
    retryTransientSync(() => renameSync(buildFile, liveFile));
  } catch (error) {
    const db = restorePrevious(liveFile, previous, false);
    removeDatabaseFilesSync(buildFile);
    return { swapped: false, db, error: error as Error };
  }
  try {
    const db = openSwapped(liveFile, faults);
    try {
      removeDatabaseFilesSync(previous);
    } catch {
      // A leftover `.previous` is harmless: the next swap removes it.
    }
    return { swapped: true, db };
  } catch (error) {
    const db = restorePrevious(liveFile, previous, true);
    return { swapped: false, db, error: error as Error };
  }
}
