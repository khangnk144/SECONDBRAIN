// Small helpers shared by repo scripts (no dependencies).
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the app/ folder (the git root). */
export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** True when the module at `metaUrl` is the script being run (`tsx scripts/x.ts`). */
export function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(entry);
}

/** Recursively lists files under `dir` whose name passes `accept`; missing dir → []. */
export function listFiles(dir: string, accept: (name: string) => boolean): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries.sort()) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, accept));
    else if (accept(name)) out.push(full);
  }
  return out;
}

/** Repo-relative POSIX path for messages. */
export function toRepoPath(file: string, root = appRoot): string {
  return path.relative(root, file).split(path.sep).join('/');
}
