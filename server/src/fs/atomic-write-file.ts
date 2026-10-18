import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export interface AtomicWriteOptions {
  /** POSIX file mode for a newly written file (e.g. 0o600 for secrets). Ignored by Windows ACLs. */
  mode?: number;
}

/** Errors Windows raises while antivirus, indexers or another reader briefly hold the target. */
const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 8;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (attempt >= RENAME_ATTEMPTS || !TRANSIENT_RENAME_ERRORS.has(code)) throw error;
      await sleep(15 * attempt);
    }
  }
}

/**
 * Writes a file atomically: the content goes to a temp file in the SAME directory
 * (so the final rename never crosses volumes), is flushed to disk, then renamed over
 * the target. A crash at any point leaves either the old file or the new one, never
 * a half-written file. The rename is retried briefly on Windows sharing violations.
 */
export async function atomicWriteFile(
  filePath: string,
  content: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  const handle = await open(tempPath, 'wx', options.mode ?? 0o666);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(tempPath, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
