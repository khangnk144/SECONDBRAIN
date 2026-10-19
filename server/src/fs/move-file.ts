import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { newTempPath, renameWithRetry } from './atomic-write-file.js';

/** Test hooks: replace the rename (to simulate `EXDEV`) or fail the copy of the fallback. */
export interface MoveFileHooks {
  rename?: (from: string, to: string) => Promise<void>;
  beforeCopy?: () => void | Promise<void>;
}

export async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function fsyncFile(filePath: string): Promise<void> {
  const handle = await open(filePath, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Moves one file, creating the destination folder. A plain rename when both sides are on the same
 * volume; across volumes (`EXDEV`, e.g. the trash folder is a junction to another drive) it copies
 * to a temp file next to the destination, verifies the hash, renames it into place and only then
 * removes the source, so a failure at any point leaves the source intact.
 */
export async function moveFile(from: string, to: string, hooks: MoveFileHooks = {}): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await (hooks.rename ?? renameWithRetry)(from, to);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
  }
  const expected = await sha256OfFile(from);
  const temp = newTempPath(path.dirname(to));
  try {
    await hooks.beforeCopy?.();
    await copyFile(from, temp);
    await fsyncFile(temp);
    if ((await sha256OfFile(temp)) !== expected) {
      throw Object.assign(new Error('copy verification failed'), { code: 'EIO' });
    }
    await renameWithRetry(temp, to);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  await unlink(from);
}
