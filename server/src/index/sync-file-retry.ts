/**
 * Synchronous file operations on the index files that survive Windows sharing violations:
 * antivirus scanners and search indexers hold freshly written files for a moment, which shows up
 * as EBUSY/EPERM/EACCES. Synchronous because the swap must not give the event loop a chance to
 * run a query between closing one connection and opening the next.
 */
import { rmSync } from 'node:fs';

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const ATTEMPTS = 8;
export const SIDE_FILES = ['-wal', '-shm', '-journal'];
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Runs `op`, retrying (15, 30, 45 … ms apart) while it fails with a transient sharing error. */
export function retryTransientSync(op: () => void): void {
  for (let attempt = 1; ; attempt += 1) {
    try {
      op();
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (attempt >= ATTEMPTS || !TRANSIENT.has(code)) throw error;
      sleepSync(15 * attempt);
    }
  }
}

/** Deletes `-wal`/`-shm`/`-journal` of a database file: a stale log must never be replayed. */
export function removeSideFilesSync(file: string): void {
  for (const suffix of SIDE_FILES)
    retryTransientSync(() => rmSync(`${file}${suffix}`, { force: true }));
}

/** Deletes a database file and its side files. */
export function removeDatabaseFilesSync(file: string): void {
  retryTransientSync(() => rmSync(file, { force: true }));
  removeSideFilesSync(file);
}
