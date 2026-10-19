import { createHash } from 'node:crypto';
import { VaultError, type VaultPath } from './vault-types.js';

/** SHA-256 of the file bytes, lowercase hex (SPEC §4.10). */
export function revisionOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// `ignoreBOM: true` keeps a leading BOM in the string, so a read → write round trip is byte-exact.
const lenientDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
const strictDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

export function decodeText(bytes: Uint8Array): string {
  return lenientDecoder.decode(bytes);
}

/** The text when the bytes are valid UTF-8, otherwise null (binary or another encoding). */
export function decodeStrict(bytes: Uint8Array): string | null {
  try {
    return strictDecoder.decode(bytes);
  } catch {
    return null;
  }
}

export function notFound(path: VaultPath): VaultError {
  return new VaultError('NOT_FOUND', `Not found: ${path}`, { path });
}

export function alreadyExists(path: VaultPath): VaultError {
  return new VaultError('EXISTS', `Already exists: ${path}`, { path });
}

export function validation(message: string, details: Record<string, unknown> = {}): VaultError {
  return new VaultError('VALIDATION', message, details);
}

/**
 * CONFLICT for one file. `current` is what is on disk now (null = the file is gone); its content
 * is included only when it was read and is valid UTF-8.
 */
export function conflict(
  path: VaultPath,
  current: { revision: string; bytes: Uint8Array | null } | null,
): VaultError {
  const details: Record<string, unknown> = { path, currentRevision: current?.revision ?? null };
  const text = current?.bytes ? decodeStrict(current.bytes) : null;
  if (text !== null) details.currentContent = text;
  return new VaultError('CONFLICT', `The file changed since it was read: ${path}`, details);
}

/** Refusal to rewrite a file whose bytes are not UTF-8 (they would be replaced by U+FFFD). */
export function notUtf8(path: VaultPath): VaultError {
  return validation('The file is not UTF-8 text; it is left unchanged', {
    path,
    reason: 'not-utf8',
  });
}

/** Refusal to write through a symlink: an atomic replace would turn the link into a plain file. */
export function isSymlinkTarget(path: VaultPath): VaultError {
  return validation('The path is a symbolic link; it is left unchanged', {
    path,
    reason: 'symlink',
  });
}

/** One file blocking an undo/complete; `expectedRevision` null = the place should be empty. */
export interface JournalConflict {
  path: VaultPath;
  expectedRevision: string | null;
  currentRevision: string | null;
}

export function journalConflict(journalId: string, conflicts: JournalConflict[]): VaultError {
  return new VaultError('CONFLICT', 'Files changed since the operation; nothing was changed', {
    journalId,
    conflicts,
  });
}

/** OS errors that mean "the disk refused the write" rather than a bug. */
const WRITE_FAILURE_CODES = new Set([
  'ENOSPC',
  'EACCES',
  'EPERM',
  'EROFS',
  'EDQUOT',
  'EBUSY',
  'EIO',
  'ENAMETOOLONG',
]);

/** Maps disk refusals to `WRITE_FAILED` with the vault path; anything else passes through. */
export function asWriteFailed(error: unknown, path: VaultPath): unknown {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (typeof code === 'string' && WRITE_FAILURE_CODES.has(code)) {
    return new VaultError('WRITE_FAILED', `Could not write ${path} (${code})`, {
      path,
      cause: code,
    });
  }
  return error;
}
