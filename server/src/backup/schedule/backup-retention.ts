/**
 * Retention of scheduled backups (SPEC F27.3): keeps the newest `keep` of the app's own zips and
 * deletes older ones. A file is the app's own only when all of this holds: it is recorded as a
 * successful run in `backups.json`, it lies in the configured folder, its name still has the
 * scheduled-backup shape, and it is a regular file with the recorded size. Anything else in the
 * folder (her own files, a renamed zip, a zip of another folder) is never touched.
 */
import { lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { isSameFolderPath } from './backup-target-folder.js';
import { isScheduledBackupName } from './scheduled-backup-name.js';
import type { BackupRun } from './schedule-types.js';

export interface RetentionResult {
  /** Files deleted now. */
  deleted: string[];
  /** Recorded files that are gone or no longer ours: marked `removed`, never deleted. */
  forgotten: string[];
}

type Ownership = 'ours' | 'gone' | 'not-ours';

async function ownership(run: BackupRun & { file: string }): Promise<Ownership> {
  try {
    const info = await lstat(run.file);
    return info.isFile() && info.size === run.bytes ? 'ours' : 'not-ours';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'gone' : 'not-ours';
  }
}

/**
 * Decides and deletes; marks the runs it settled as `removed` in place (the caller saves them).
 * `remove` is injectable so a test can make a deletion fail.
 */
export async function applyRetention(
  runs: BackupRun[],
  folder: string,
  keep: number,
  remove: (file: string) => Promise<void> = unlink,
): Promise<RetentionResult> {
  const result: RetentionResult = { deleted: [], forgotten: [] };
  const candidates = runs.filter(
    (run): run is BackupRun & { file: string } =>
      run.ok &&
      !run.removed &&
      run.file !== null &&
      isSameFolderPath(path.dirname(run.file), folder) &&
      isScheduledBackupName(path.basename(run.file)),
  );
  const present: (BackupRun & { file: string })[] = [];
  for (const run of candidates) {
    const owned = await ownership(run);
    if (owned === 'ours') present.push(run);
    else {
      run.removed = true;
      result.forgotten.push(run.file);
    }
  }
  present.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  for (const run of present.slice(keep)) {
    try {
      await remove(run.file);
      run.removed = true;
      result.deleted.push(run.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') run.removed = true;
      // Otherwise (locked by a sync client…): tried again after the next backup.
    }
  }
  return result;
}
