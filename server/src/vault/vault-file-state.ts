import { readFile, stat } from 'node:fs/promises';
import { sha256OfFile } from '../fs/move-file.js';
import { revisionOf } from './vault-errors.js';

/** Above this size a file is hashed as a stream instead of being read into memory. */
export const LARGE_FILE_BYTES = 1024 ** 3;

/** The revision of a file, with its bytes when it is small enough to hold in memory. */
export interface FileState {
  revision: string;
  /** null for files above the large-file limit. */
  bytes: Buffer | null;
}

/** Errors that mean "no file there"; anything else (EACCES, EIO, …) is a real failure. */
const MISSING_CODES = new Set(['ENOENT', 'EISDIR', 'ENOTDIR']);

export function isMissingError(error: unknown): boolean {
  return MISSING_CODES.has((error as NodeJS.ErrnoException | null)?.code ?? '');
}

/** File bytes, or null when no file is there. Other read errors propagate. */
export async function readIfFile(abs: string): Promise<Buffer | null> {
  try {
    return await readFile(abs);
  } catch (error) {
    if (isMissingError(error)) return null;
    throw error;
  }
}

export function stateOf(bytes: Buffer): FileState {
  return { revision: revisionOf(bytes), bytes };
}

/** Revision (and bytes when small) of the file at `abs`, or null when no regular file is there. */
export async function readFileState(
  abs: string,
  largeFileBytes = LARGE_FILE_BYTES,
): Promise<FileState | null> {
  try {
    const info = await stat(abs);
    if (!info.isFile()) return null;
    if (info.size > largeFileBytes) return { revision: await sha256OfFile(abs), bytes: null };
  } catch (error) {
    if (isMissingError(error)) return null;
    throw error;
  }
  const bytes = await readIfFile(abs);
  return bytes ? stateOf(bytes) : null;
}
