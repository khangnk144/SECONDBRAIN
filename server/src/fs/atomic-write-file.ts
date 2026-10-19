import { randomBytes } from 'node:crypto';
import { link, lstat, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Fault-injection points for tests. `beforeWrite` runs with the temp file open: a throw behaves
 * like a failed write (the temp file is removed, the target untouched). `beforeRename` runs after
 * the temp file is flushed: a throw leaves the temp file behind exactly as a crash would.
 * `link` replaces the hard-link call of `atomicCreateFile` (to simulate a file system without
 * hard links).
 */
export interface AtomicWriteHooks {
  beforeWrite?: () => void | Promise<void>;
  beforeRename?: (tempPath: string) => void | Promise<void>;
  link?: (from: string, to: string) => Promise<void>;
}

export interface AtomicWriteOptions {
  /** POSIX mode for the file (e.g. 0o600 for secrets). Without it a replaced file keeps its mode. */
  mode?: number;
  hooks?: AtomicWriteHooks;
}

/** Errors Windows raises while antivirus, indexers or another reader briefly hold the target. */
const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 8;

/**
 * Temp names are short and fixed-length (`.sb-<12 hex>.tmp`) so a target name of the maximum
 * length still leaves room for its temp file. The older `.<target name>.<12 hex>.tmp` form is
 * still recognised so leftovers of earlier versions are cleaned up too.
 */
const TEMP_NAME = /^\.sb-[0-9a-f]{12}\.tmp$/;
const LEGACY_TEMP_NAME = /^\..+\.[0-9a-f]{12}\.tmp$/;

export function isAtomicTempName(name: string): boolean {
  return TEMP_NAME.test(name) || LEGACY_TEMP_NAME.test(name);
}

export function newTempPath(dir: string): string {
  return path.join(dir, `.sb-${randomBytes(6).toString('hex')}.tmp`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function renameWithRetry(from: string, to: string): Promise<void> {
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

async function existingMode(filePath: string): Promise<number | undefined> {
  try {
    return (await stat(filePath)).mode & 0o7777;
  } catch {
    return undefined;
  }
}

/** Writes and flushes the content to a new temp file next to `filePath`; returns its path. */
async function writeTempFile(
  filePath: string,
  content: string | Uint8Array,
  options: AtomicWriteOptions,
): Promise<string> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const mode = options.mode ?? (await existingMode(filePath));
  const tempPath = newTempPath(dir);
  const handle = await open(tempPath, 'wx', options.mode ?? 0o666);
  try {
    await options.hooks?.beforeWrite?.();
    await handle.writeFile(content);
    // The replacement keeps the permissions of the file it replaces (umask applies on create).
    if (mode !== undefined) await handle.chmod(mode);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(tempPath, { force: true });
    throw error;
  }
  await handle.close();
  await options.hooks?.beforeRename?.(tempPath);
  return tempPath;
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
  const tempPath = await writeTempFile(filePath, content, options);
  try {
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

/** Link failures that mean "this file system has no hard links" (FAT/exFAT drives, some shares). */
const NO_HARD_LINKS = new Set([
  'EPERM',
  'EACCES',
  'ENOTSUP',
  'EOPNOTSUPP',
  'EXDEV',
  'ENOSYS',
  'EINVAL',
  'EMLINK',
]);

function existsError(filePath: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`EEXIST: file already exists, '${filePath}'`), { code: 'EEXIST' });
}

/**
 * Creates a new file atomically and never replaces one: the temp file is hard-linked to the
 * target, which fails with `EEXIST` if another program created the name in the meantime. Where
 * hard links are unsupported it falls back to check-then-rename (a tiny window remains there).
 */
export async function atomicCreateFile(
  filePath: string,
  content: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const tempPath = await writeTempFile(filePath, content, options);
  try {
    try {
      await (options.hooks?.link ?? link)(tempPath, filePath);
    } catch (error) {
      if (!NO_HARD_LINKS.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
      if (
        await lstat(filePath).then(
          () => true,
          () => false,
        )
      )
        throw existsError(filePath);
      await renameWithRetry(tempPath, filePath);
      return;
    }
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
  await rm(tempPath, { force: true });
}
