/**
 * Never two backups at once (SPEC F27.2): one per install in this process (a vault switch closes
 * the old plugin first, but a manual run may race the timer), and a lock file
 * `<home>/.secondbrain/backup.lock` for a second process on the same install. A lock left by a
 * process that is gone, or older than `STALE_LOCK_MS`, is taken over.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const BACKUP_LOCK_FILE = 'backup.lock';
/** A run that holds the lock this long has crashed or hangs: the lock is taken over. */
export const STALE_LOCK_MS = 6 * 60 * 60_000;

const heldHere = new Set<string>();

export type ReleaseLock = () => Promise<void>;

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return false; // not held in this process (checked first): left over
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function isStale(file: string, now: Date): Promise<boolean> {
  try {
    const { pid, at } = JSON.parse(await readFile(file, 'utf8')) as { pid?: number; at?: string };
    const age = now.getTime() - Date.parse(at ?? '');
    return !processAlive(Number(pid)) || !(age < STALE_LOCK_MS);
  } catch (error) {
    // Unreadable or half-written: stale unless it simply vanished (then retry the create).
    return (error as NodeJS.ErrnoException).code !== 'EBUSY';
  }
}

/** The lock, or null when another run (here or in another process) holds it. */
export async function acquireBackupLock(
  globalStateDir: string,
  now: () => Date,
): Promise<ReleaseLock | null> {
  const key = path.resolve(globalStateDir);
  if (heldHere.has(key)) return null;
  heldHere.add(key);
  const file = path.join(key, BACKUP_LOCK_FILE);
  const body = JSON.stringify({ pid: process.pid, at: now().toISOString() });
  await mkdir(key, { recursive: true }).catch(() => undefined);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(file, body, { flag: 'wx' });
      return async () => {
        await rm(file, { force: true }).catch(() => undefined);
        heldHere.delete(key);
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' || attempt > 0 || !(await isStale(file, now()))) break;
      await rm(file, { force: true }).catch(() => undefined);
    }
  }
  heldHere.delete(key);
  return null;
}
