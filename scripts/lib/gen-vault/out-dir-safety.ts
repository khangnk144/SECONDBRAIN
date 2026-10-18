// Guards so the generator can never write into the owner's real vault or over existing files.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

const caseFold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);

/** realpath of the nearest existing ancestor, with the missing tail re-appended. */
export function resolveThroughLinks(target: string): string {
  let current = path.resolve(target);
  const tail: string[] = [];
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    tail.unshift(path.basename(current));
    current = parent;
  }
  const base = existsSync(current) ? realpathSync.native(current) : current;
  return path.join(base, ...tail);
}

/** True when `child` is `parent` or below it. `<parent>/..x` is below it; `<parent>/../x` is not. */
export function isInsideOrEqual(child: string, parent: string): boolean {
  const rel = path.relative(caseFold(parent), caseFold(child));
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  return !(rel === '..' || rel.startsWith(`..${path.sep}`));
}

/**
 * Windows silently drops trailing dots and spaces from path segments (`vault.` is `vault`),
 * so such paths could alias the real vault. Refuse them on every platform.
 */
export function findTrailingDotOrSpaceSegment(target: string): string | null {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  const segments = resolved.slice(root.length).split(/[\\/]+/);
  return segments.find((s) => s !== '' && /[. ]$/.test(s)) ?? null;
}

/**
 * Every folder the owner's vault may live in: `<install root>/vault` plus `vaultPath` from
 * `<install root>/.secondbrain/settings.json` (absolute, or relative to the install root).
 */
export function knownVaultDirs(installRoot: string): string[] {
  const dirs = [path.join(installRoot, 'vault')];
  const settingsFile = path.join(installRoot, '.secondbrain', 'settings.json');
  if (existsSync(settingsFile)) {
    let vaultPath: unknown;
    try {
      vaultPath = (JSON.parse(readFileSync(settingsFile, 'utf8')) as { vaultPath?: unknown })
        .vaultPath;
    } catch {
      throw new Error(`Cannot read ${settingsFile}; refusing to guess where the vault is.`);
    }
    if (typeof vaultPath === 'string' && vaultPath.trim() !== '') {
      dirs.push(path.resolve(installRoot, vaultPath));
    }
  }
  return dirs;
}

/** Throws when `outDir` is a vault (or inside one), has a risky segment, or is non-empty. */
export function assertSafeOutDir(outDir: string, vaultDirs: string | string[]): void {
  const out = path.resolve(outDir);
  const risky = findTrailingDotOrSpaceSegment(out);
  if (risky !== null) {
    throw new Error(
      `Refusing --out with a folder name ending in a dot or space ("${risky}"): Windows would strip it.`,
    );
  }
  for (const dir of Array.isArray(vaultDirs) ? vaultDirs : [vaultDirs]) {
    const vault = path.resolve(dir);
    if (
      isInsideOrEqual(out, vault) ||
      isInsideOrEqual(resolveThroughLinks(out), resolveThroughLinks(vault))
    ) {
      throw new Error(
        `Refusing to generate inside the real vault (${vault}). Choose another --out folder.`,
      );
    }
  }
  if (existsSync(out) && readdirSync(out).length > 0) {
    throw new Error(`Refusing to generate into a non-empty folder: ${out}`);
  }
}
