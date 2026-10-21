import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, readFile, readdir, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { findVaultOverlap } from '../config/vault-location.js';
import { atomicWriteFile, renameWithRetry } from '../fs/atomic-write-file.js';
import { refuse } from './backup-errors.js';

export interface RestoreTarget {
  /** Absolute folder the vault is restored into. */
  folder: string;
  parent: string;
}

async function isEmptyFolder(folder: string): Promise<boolean | null> {
  let stats;
  try {
    stats = await lstat(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw refuse('target-invalid');
  }
  if (!stats.isDirectory()) throw refuse('target-invalid');
  return (await readdir(folder)).length === 0;
}

/**
 * "Khôi phục thử" target rules (SPEC F18): an absolute path that does not exist yet or is an
 * empty folder, whose parent exists and is writable, outside the open vault and the app's own
 * folders. Neither may be inside the target nor the target inside them (real paths compared,
 * letter case ignored on Windows); the overlap is named before "not empty".
 */
export async function checkRestoreTarget(
  target: unknown,
  guard: { vaultRoot: string; protectedDirs: readonly string[] },
): Promise<RestoreTarget> {
  if (
    typeof target !== 'string' ||
    target.length > 4096 ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f]/.test(target) ||
    !path.isAbsolute(target)
  ) {
    throw refuse('target-invalid');
  }
  const folder = path.resolve(target);
  const parent = path.dirname(folder);
  if (parent === folder) throw refuse('target-invalid'); // a drive root cannot be renamed onto
  if ((await findVaultOverlap(folder, [guard.vaultRoot])) !== null)
    throw refuse('target-inside-vault');
  if ((await findVaultOverlap(folder, guard.protectedDirs)) !== null) throw refuse('overlaps-app');
  if ((await isEmptyFolder(folder)) === false) throw refuse('target-not-empty');
  try {
    if (!(await stat(parent)).isDirectory()) throw new Error('not a folder');
    await access(parent, constants.W_OK);
  } catch {
    throw refuse('target-invalid');
  }
  return { folder, parent };
}

/** A temp folder next to the target (same volume, so the final rename is atomic); ours alone. */
export async function createRestoreWorkDir(parent: string): Promise<string> {
  const dir = path.join(parent, `.sb-restore-${randomBytes(6).toString('hex')}`);
  try {
    await mkdir(dir);
  } catch {
    throw refuse('target-invalid');
  }
  return dir;
}

/** Renames the extracted folder onto the target (an empty target folder is replaced). */
export async function moveIntoPlace(extracted: string, target: RestoreTarget): Promise<void> {
  const empty = await isEmptyFolder(target.folder);
  if (empty === false) throw refuse('target-not-empty');
  if (empty) await rmdir(target.folder); // Windows cannot rename onto an existing folder
  try {
    await renameWithRetry(extracted, target.folder);
  } catch (error) {
    if (empty) await mkdir(target.folder).catch(() => undefined); // put the user's folder back
    throw error;
  }
}

const vaultFileOf = (folder: string) => path.join(folder, '.secondbrain', 'vault.json');

/** The identity of the restored vault (`.secondbrain/vault.json`), or null when it has none. */
export async function readRestoredVaultId(folder: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(vaultFileOf(folder), 'utf8')) as { id?: unknown };
    return typeof parsed.id === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.id) ? parsed.id : null;
  } catch {
    return null;
  }
}

/**
 * A restored copy lives in a new folder next to the original, so it gets a vault id of its own
 * (everything else in `vault.json` stays): the stale-window guard (`x-sb-vault-id`) can then tell
 * a window of the original from one of the copy, and a save meant for one never lands in the
 * other. A copy without a usable `vault.json` is left alone (opening it creates or refuses one).
 */
export async function giveRestoredVaultNewId(folder: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(vaultFileOf(folder), 'utf8'));
  } catch {
    return;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
  if (typeof (parsed as { id?: unknown }).id !== 'string') return;
  const oldId = (parsed as { id: string }).id;
  const newId = randomUUID();
  await carryReminderKeys(folder, oldId, newId);
  // Same layout as the vault writes its state files (two-space JSON and a final newline).
  const next = { ...parsed, id: newId };
  await atomicWriteFile(vaultFileOf(folder), `${JSON.stringify(next, null, 2)}\n`);
}

const remindersFileOf = (folder: string) =>
  path.join(folder, '.secondbrain', 'state', 'reminders.json');

/**
 * Reminder dedupe keys start with the vault id (`<vaultId>|<item>|<due>|<threshold>`). The copy
 * keeps what the backup had already reminded, so its keys move to the new id: otherwise the
 * restored copy would remind every item again. A file that is not valid JSON is left as it is
 * (the reminder store keeps a copy of it and starts over when the vault opens).
 */
async function carryReminderKeys(folder: string, oldId: string, newId: string): Promise<void> {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(remindersFileOf(folder), 'utf8'));
  } catch {
    return;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return;
  const prefix = `${oldId}|`;
  let changed = false;
  const rekey = (list: unknown): unknown => {
    if (!Array.isArray(list)) return list;
    return list.map((record: unknown) => {
      if (typeof record !== 'object' || record === null) return record;
      const key = (record as { key?: unknown }).key;
      if (typeof key !== 'string' || !key.startsWith(prefix)) return record;
      changed = true;
      return { ...record, key: `${newId}|${key.slice(prefix.length)}` };
    });
  };
  const store = data as { entries?: unknown; superseded?: unknown };
  const next = { ...store, entries: rekey(store.entries), superseded: rekey(store.superseded) };
  if (!changed) return;
  await atomicWriteFile(remindersFileOf(folder), `${JSON.stringify(next, null, 2)}\n`);
}
