/**
 * A scheduled backup streams its zip into `.sb-<12 hex>.tmp` in the backup folder and removes it
 * in `finally`; a power loss or a killed process mid-stream leaves it there, as large as the
 * vault, and retention never sees it (it only knows recorded zips). Each run therefore first
 * removes such temp files of the app's own shape that are older than `STALE_LOCK_MS` – while it
 * holds the backup lock, so no live run of this install can still be writing one. Only regular
 * files are touched (never a link or a folder), and a failure here never stops the backup.
 */
import { lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { STALE_LOCK_MS } from './backup-run-lock.js';

/** The exact name `newTempPath` gives (`.sb-` + 6 random bytes in hex + `.tmp`). */
const TEMP_NAME = /^\.sb-[0-9a-f]{12}\.tmp$/;

/** Removes stale temp files in `folder`; resolves with how many were removed. */
export async function removeStaleBackupTemps(
  folder: string,
  now: Date,
  maxAgeMs = STALE_LOCK_MS,
): Promise<number> {
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!TEMP_NAME.test(name)) continue;
    const file = path.join(folder, name);
    try {
      const info = await lstat(file);
      if (!info.isFile() || now.getTime() - info.mtimeMs < maxAgeMs) continue;
      await rm(file, { force: true });
      removed += 1;
    } catch {
      // Locked or gone meanwhile: the next run tries again.
    }
  }
  return removed;
}
