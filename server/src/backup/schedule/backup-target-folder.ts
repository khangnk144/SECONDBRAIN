/**
 * Where scheduled backups go (SPEC F27.1): `backup.schedule.folder`, or `<home>/Backups` while it
 * is null (created on the first run). A folder inside the vault is refused (the zip would back
 * itself up the next night), and so is one inside the app's own folders. A chosen folder must
 * exist: a missing USB drive is an error to show, not a folder to create on the C: drive.
 */
import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { defaultBackupFolder } from '../../config/settings-sections-m5.js';
import type { BackupFailure, FolderProblem } from './schedule-types.js';

export class BackupFolderError extends Error {
  constructor(readonly reason: BackupFailure) {
    super(`The backup folder cannot be used (${reason}).`);
    this.name = 'BackupFolderError';
  }
}

export interface TargetFolder {
  folder: string;
  isDefault: boolean;
}

/** The folder from the settings (absolute), else the default one. */
export function targetFolderOf(configured: string | null, home: string): TargetFolder {
  if (configured) return { folder: path.resolve(configured), isDefault: false };
  return { folder: defaultBackupFolder(home), isDefault: true };
}

/** Real path of `p`, also when it does not exist yet (its deepest existing ancestor resolved). */
async function realOrPlanned(p: string): Promise<string> {
  const absolute = path.resolve(p);
  try {
    return await realpath(absolute);
  } catch {
    const parent = path.dirname(absolute);
    if (parent === absolute) return absolute;
    return path.join(await realOrPlanned(parent), path.basename(absolute));
  }
}

function fold(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/** `inner` is `outer` or below it (case-insensitive on Windows). */
export function isSameOrInside(outer: string, inner: string): boolean {
  const relative = path.relative(fold(outer), fold(inner));
  if (relative === '') return true;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Same folder by name (the zips' records keep the path they were written to). */
export function isSameFolderPath(a: string, b: string): boolean {
  return fold(path.resolve(a)) === fold(path.resolve(b));
}

/** Why this folder can never hold the backups of this vault, or null (links resolved). */
export async function folderProblem(
  folder: string | null,
  vaultRoot: string,
  protectedDirs: readonly string[],
): Promise<FolderProblem | null> {
  if (folder !== null && !path.isAbsolute(folder)) return 'not-absolute';
  if (folder === null) return null;
  const real = await realOrPlanned(folder);
  if (isSameOrInside(await realOrPlanned(vaultRoot), real)) return 'inside-vault';
  for (const dir of protectedDirs) {
    if (isSameOrInside(await realOrPlanned(dir), real)) return 'inside-app';
  }
  return null;
}

/** Checks the folder and creates the default one; throws `BackupFolderError`. */
export async function prepareTargetFolder(
  target: TargetFolder,
  vaultRoot: string,
  protectedDirs: readonly string[],
): Promise<string> {
  const problem = await folderProblem(target.folder, vaultRoot, protectedDirs);
  if (problem === 'not-absolute') throw new BackupFolderError('folder-missing');
  if (problem) throw new BackupFolderError(problem);
  if (target.isDefault) {
    await mkdir(target.folder, { recursive: true }).catch((error: unknown) => {
      throw new BackupFolderError(failureOf(error));
    });
  }
  let info;
  try {
    info = await stat(target.folder);
  } catch (error) {
    throw new BackupFolderError(failureOf(error));
  }
  if (!info.isDirectory()) throw new BackupFolderError('not-a-folder');
  return target.folder;
}

/** The plain reason of a file-system error while writing a backup. */
export function failureOf(error: unknown): BackupFailure {
  if (error instanceof BackupFolderError) return error.reason;
  // A VaultError WRITE_FAILED (the zip is built in the vault's cache first) carries the cause.
  const cause = (error as { details?: { cause?: unknown } } | null)?.details?.cause;
  const code =
    typeof cause === 'string' ? cause : ((error as NodeJS.ErrnoException | null)?.code ?? '');
  if (code === 'ENOENT') return 'folder-missing';
  if (code === 'ENOTDIR') return 'not-a-folder';
  if (code === 'ENOSPC' || code === 'EDQUOT') return 'disk-full';
  if (['EACCES', 'EPERM', 'EROFS', 'EBUSY'].includes(code)) return 'not-writable';
  if ((error as { reason?: string } | null)?.reason === 'too-large') return 'too-large';
  return 'failed';
}
