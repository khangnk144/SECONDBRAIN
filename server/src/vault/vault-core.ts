import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../fs/atomic-write-file.js';
import { assertInsideVault, guardVaultPath } from '../security/path-guard.js';
import { asWriteFailed, isSymlinkTarget, notFound } from './vault-errors.js';
import type { VaultFaults } from './vault-faults.js';
import { readIfFile } from './vault-file-state.js';
import { locate, toVaultPath, type DiskLocation, type MatchMode } from './vault-disk-names.js';
import type { WriteQueue } from './write-queue.js';
import type { RelinkPlanner, VaultChange, VaultPath, VaultStatePaths } from './vault-types.js';

/** Housekeeping problems that must not stop the vault (no note content in them). */
export type VaultWarning = (message: string, details?: Record<string, unknown>) => void;

/** Shared state of one open vault, passed to the operation modules. */
export interface VaultCore {
  /** Real path of the vault root. */
  root: string;
  id: string;
  paths: VaultStatePaths;
  faults: VaultFaults;
  now: () => Date;
  newId: () => string;
  queue: WriteQueue;
  emit: (change: VaultChange) => void;
  warn: VaultWarning;
  planner: RelinkPlanner | null;
}

/**
 * Guard + map + containment check: the only way an operation turns a vault path into a disk path.
 * The returned `vaultPath` is spelled as on disk (true letter case on Windows, NFC), whatever the
 * request's spelling, so events, results and journal steps never name one file two ways.
 */
export async function resolvePath(
  core: VaultCore,
  input: VaultPath,
  mode: MatchMode,
): Promise<DiskLocation> {
  const guarded = guardVaultPath(input);
  const location = await locate(core.root, guarded, mode);
  const real = await assertInsideVault(core.root, location.abs, guarded);
  return { ...location, vaultPath: toVaultPath(core.root, real) };
}

/** An existing regular file, or NOT_FOUND (folders count as missing). */
export async function resolveFile(core: VaultCore, input: VaultPath): Promise<DiskLocation> {
  const location = await resolvePath(core, input, 'fast');
  if (location.kind !== 'file') throw notFound(location.vaultPath);
  return location;
}

/** Mutations never go through a symlink: replacing it would turn the link into a plain file. */
export async function assertNotSymlink(
  location: DiskLocation,
  requested: VaultPath,
): Promise<void> {
  let isLink = false;
  try {
    isLink = (await lstat(location.abs)).isSymbolicLink();
  } catch {
    // Nothing there: the caller reports the missing file its own way.
  }
  if (isLink) throw isSymlinkTarget(guardVaultPath(requested));
}

/** `.secondbrain/...` label of an internal state file, for error details. */
function stateLabel(paths: VaultStatePaths, abs: string): string {
  return ['.secondbrain', ...path.relative(paths.appDir, abs).split(path.sep)].join('/');
}

/** Atomic write of internal state (journal, trash meta, identity); disk refusals → WRITE_FAILED. */
export async function writeStateFile(
  paths: VaultStatePaths,
  abs: string,
  content: string | Uint8Array,
): Promise<void> {
  try {
    await atomicWriteFile(abs, content);
  } catch (error) {
    throw asWriteFailed(error, stateLabel(paths, abs));
  }
}

export async function writeStateJson(
  paths: VaultStatePaths,
  abs: string,
  value: unknown,
): Promise<void> {
  await writeStateFile(paths, abs, `${JSON.stringify(value, null, 2)}\n`);
}

/** Parsed JSON, or null when the file is missing or not JSON; read errors propagate. */
export async function readStateJson(abs: string): Promise<unknown> {
  const bytes = await readIfFile(abs);
  if (!bytes) return null;
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    return null;
  }
}
