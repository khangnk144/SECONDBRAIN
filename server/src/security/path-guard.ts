import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { realPath } from '../fs/real-path.js';
import { VaultError, type VaultPath } from '../vault/vault-types.js';

/** First segments only internal services may touch (per-vault app state and git metadata). */
const INTERNAL_TOP_FOLDERS = new Set(['.secondbrain', '.git']);
/** Characters Windows refuses in names; `:` also blocks NTFS alternate data streams. */
const WINDOWS_INVALID_CHARS = /[<>:"|?*]/;
/** Device names Windows reserves in any folder, with or without an extension. */
const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i;
const MAX_SEGMENT_LENGTH = 255;

function invalid(input: string, reason: string): VaultError {
  return new VaultError('INVALID_PATH', `Invalid vault path (${reason})`, { path: input, reason });
}

/** Why one path segment is unusable on Windows, or null when it is fine. */
export function segmentProblem(segment: string): string | null {
  if (segment === '') return 'empty-segment';
  if (segment === '..') return 'dotdot';
  if (segment === '.') return 'dot-segment';
  if (WINDOWS_INVALID_CHARS.test(segment)) return 'invalid-char';
  if (segment.endsWith('.') || segment.endsWith(' ')) return 'trailing-dot-or-space';
  // Windows ignores the extension and trailing spaces when matching device names (`con .md`).
  const stem = segment.split('.')[0]!.trimEnd();
  if (RESERVED_DEVICE_NAME.test(stem)) return 'reserved-name';
  if (segment.normalize('NFC').length > MAX_SEGMENT_LENGTH) return 'too-long';
  return null;
}

export function isInternalTopFolder(segment: string): boolean {
  return INTERNAL_TOP_FOLDERS.has(segment.toLowerCase());
}

/**
 * Syntactic check of a vault path coming from a request or tool. Returns the canonical form
 * (forward slashes, NFC) or throws `INVALID_PATH`. The input is NOT percent-decoded: the HTTP layer
 * decoded it once already, and a literal `%2e%2e` is a legitimate file name.
 */
export function guardVaultPath(input: string): VaultPath {
  if (typeof input !== 'string') throw invalid(String(input), 'not-a-string');
  const slashed = input.replace(/\\/g, '/');
  if (slashed === '') throw invalid(input, 'empty');
  for (let i = 0; i < slashed.length; i += 1) {
    const code = slashed.charCodeAt(i);
    if (code === 0) throw invalid(input, 'nul');
    if (code < 0x20) throw invalid(input, 'control-char');
  }
  if (slashed.startsWith('//')) throw invalid(input, 'unc');
  if (slashed.startsWith('/') || /^[a-zA-Z]:/.test(slashed)) throw invalid(input, 'absolute');
  const segments = slashed.split('/');
  for (const segment of segments) {
    const problem = segmentProblem(segment);
    if (problem) throw invalid(input, problem);
  }
  if (isInternalTopFolder(segments[0]!)) throw invalid(input, 'internal-folder');
  return slashed.normalize('NFC');
}

const caseFold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);

/** True when `candidate` (a real path) is `root` itself or inside it. */
function isInside(rootReal: string, candidate: string): boolean {
  const rel = path.relative(caseFold(rootReal), caseFold(candidate));
  // `..Lưu trữ` is a legal name inside the vault: only a whole `..` segment leaves it.
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Containment check on disk: the realpath of the deepest existing ancestor of `absPath` (and of
 * `absPath` itself when it exists) must stay inside the vault root, so a symlink or junction in the
 * vault cannot lead reads or writes outside it, nor into the internal folders through an alias.
 * Returns the real absolute path (resolved prefix + the not-yet-existing rest), whose spelling is
 * the true on-disk one.
 */
export async function assertInsideVault(
  rootReal: string,
  absPath: string,
  vaultPath: VaultPath,
): Promise<string> {
  let probe = absPath;
  while (!(await exists(probe))) {
    const parent = path.dirname(probe);
    if (parent === probe) throw invalid(vaultPath, 'outside-vault');
    probe = parent;
  }
  let real: string;
  try {
    real = await realPath(probe);
  } catch {
    // A dangling symlink: its target does not exist, so we cannot prove it stays inside.
    throw invalid(vaultPath, 'outside-vault');
  }
  if (!isInside(rootReal, real)) throw invalid(vaultPath, 'outside-vault');
  const first = path.relative(rootReal, real).split(path.sep)[0] ?? '';
  if (isInternalTopFolder(first)) throw invalid(vaultPath, 'internal-folder');
  return path.join(real, path.relative(probe, absPath));
}
