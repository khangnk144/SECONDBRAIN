import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { GlobalSettings } from './global-settings.js';

/**
 * Absolute vault folder: `settings.vaultPath` (relative values are taken from the install root)
 * or `<home>/vault` by default (SPEC §3).
 */
export function resolveVaultRoot(
  settings: Pick<GlobalSettings, 'vaultPath'>,
  homeDir: string,
): string {
  return settings.vaultPath
    ? path.resolve(homeDir, settings.vaultPath)
    : path.join(homeDir, 'vault');
}

/** Real path of `p`, also when it does not exist yet (its deepest existing ancestor is resolved). */
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

/** `inner` is `outer` itself or lies below it (case-insensitive on Windows). */
function isSameOrInside(outer: string, inner: string): boolean {
  const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const relative = path.relative(fold(outer), fold(inner));
  if (relative === '') return true;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * The install folder a vault would overlap, or null. A vault must not be, contain or sit inside
 * the global state folder (`settings.json` holds the session token and later API keys, and
 * would become a vault file served by `/api/files`) or the app folder (source code).
 */
export async function findVaultOverlap(
  vaultRoot: string,
  protectedDirs: readonly string[],
): Promise<string | null> {
  const vault = await realOrPlanned(vaultRoot);
  for (const dir of protectedDirs) {
    const real = await realOrPlanned(dir);
    if (isSameOrInside(vault, real) || isSameOrInside(real, vault)) return dir;
  }
  return null;
}

/** Both paths name the same folder once links are resolved (case-insensitive on Windows). */
export async function isSameFolder(a: string, b: string): Promise<boolean> {
  const [realA, realB] = await Promise.all([realOrPlanned(a), realOrPlanned(b)]);
  return isSameOrInside(realA, realB) && isSameOrInside(realB, realA);
}
