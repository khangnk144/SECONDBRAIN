/**
 * Puts a finished zip into the backup folder without ever leaving a partial `.zip` behind: the
 * bytes are streamed (another drive is fine) into a temp file of that folder, flushed, then
 * hard-linked to the final name, which never replaces a file that exists (`EEXIST` → the next
 * ` (n)` name). Any other `link` error means "no hard links here" and falls back to
 * check-then-rename: the codes differ by drive and OS (Windows reports FAT/exFAT's
 * ERROR_INVALID_FUNCTION as `EISDIR`, SMB shares answer `EINVAL`, others `EPERM`, `ENOTSUP`,
 * `EXDEV`…), and the rename that follows reports a real problem with its own code. On any failure
 * the temp file is removed.
 */
import { createWriteStream } from 'node:fs';
import { link, lstat, open, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { newTempPath, renameWithRetry } from '../../fs/atomic-write-file.js';
import { MAX_NAME_ATTEMPTS } from './scheduled-backup-name.js';

/** Test-only fault points. */
export interface PlaceZipHooks {
  /** Runs once the temp file is complete and flushed (a throw = e.g. a full disk at the end). */
  beforeLink?: (tempPath: string) => void | Promise<void>;
  link?: (from: string, to: string) => Promise<void>;
}

const exists = (p: string) =>
  lstat(p).then(
    () => true,
    () => false,
  );

async function flush(file: string): Promise<number> {
  const handle = await open(file, 'r+');
  try {
    await handle.sync();
    return (await handle.stat()).size;
  } finally {
    await handle.close();
  }
}

/** Links (or renames) `temp` to the first free candidate name; returns the path used. */
async function claimName(
  temp: string,
  folder: string,
  nameFor: (n: number) => string,
  hooks: PlaceZipHooks,
): Promise<{ file: string; moved: boolean }> {
  let hardLinks = true;
  for (let n = 1; n <= MAX_NAME_ATTEMPTS; n += 1) {
    const file = path.join(folder, nameFor(n));
    if (hardLinks) {
      try {
        await (hooks.link ?? link)(temp, file);
        return { file, moved: false };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        hardLinks = false; // this drive has none: check-then-rename from here on
      }
    }
    if (await exists(file)) continue;
    await renameWithRetry(temp, file);
    return { file, moved: true };
  }
  throw Object.assign(new Error('No free backup file name.'), { code: 'EEXIST' });
}

export async function placeBackupZip(
  source: Readable,
  folder: string,
  nameFor: (n: number) => string,
  hooks: PlaceZipHooks = {},
): Promise<{ file: string; bytes: number }> {
  const temp = newTempPath(folder);
  let placed = false;
  try {
    await pipeline(source, createWriteStream(temp, { flags: 'wx' }));
    const bytes = await flush(temp);
    await hooks.beforeLink?.(temp);
    const { file, moved } = await claimName(temp, folder, nameFor, hooks);
    placed = moved;
    return { file, bytes };
  } catch (error) {
    source.destroy(); // the built zip in the vault cache is removed when its stream closes
    throw error;
  } finally {
    if (!placed) await rm(temp, { force: true }).catch(() => undefined);
  }
}
