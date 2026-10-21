/**
 * Makes the vault a git repository for version history (SPEC F20): `git init` when the vault
 * root itself has no `.git` (a parent repository does not count), a repo-local identity only
 * where none resolves, and the ignore rules in `.git/info/exclude` – not a `.gitignore`, so the
 * user's folder gets no new file. Global and system config are never written.
 */
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GitRunner } from './git-runner.js';

export const HISTORY_IDENTITY = { name: 'Second Brain', email: 'second-brain@localhost' } as const;

/** Derived, deletable or temporary files that never belong in the history (SPEC §4.13). */
export const EXCLUDE_RULES = [
  '/.secondbrain/cache/',
  '/.secondbrain/trash/',
  '/.secondbrain/logs/',
  '.sb-*.tmp',
  '.sb-*.renaming',
] as const;
const EXCLUDE_HEADER = '# Second Brain: app caches, logs, trash and temp files';

/**
 * `.git/info/attributes` outranks any `.gitattributes` in the vault: history stores every file
 * byte for byte (no line-ending normalization, clean/smudge filters or keyword expansion), so a
 * restored version is exactly what was on disk.
 */
export const BYTE_EXACT_ATTRIBUTES = '* -text -filter -ident -working-tree-encoding';
const ATTRIBUTES_HEADER = '# Second Brain: keep file bytes exactly as written';

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch {
    return false;
  }
}

/** A path git printed (relative to the vault root unless absolute). */
async function gitPath(git: GitRunner, root: string, name: string): Promise<string> {
  const { stdout } = await git.run(['rev-parse', '--git-path', name]);
  const printed = stdout.toString('utf8').replace(/\r?\n$/, '');
  return path.resolve(root, printed);
}

async function ensureIdentity(git: GitRunner): Promise<void> {
  for (const [key, value] of [
    ['user.name', HISTORY_IDENTITY.name],
    ['user.email', HISTORY_IDENTITY.email],
  ] as const) {
    // Exit code 1 = not set anywhere git looks (repo, global, system, includes).
    const current = await git.run(['config', '--get', key], { okExitCodes: [1] });
    if (current.stdout.toString('utf8').trim() === '') {
      await git.run(['config', '--local', key, value]);
    }
  }
}

async function ensureExcludeRules(git: GitRunner, root: string): Promise<void> {
  const file = await gitPath(git, root, 'info/exclude');
  const current = await readFile(file, 'utf8').catch(() => '');
  const present = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = EXCLUDE_RULES.filter((rule) => !present.has(rule));
  if (missing.length === 0) return;
  const header = present.has(EXCLUDE_HEADER) ? [] : [EXCLUDE_HEADER];
  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${current}${separator}${[...header, ...missing].join('\n')}\n`);
}

async function ensureByteExactAttributes(git: GitRunner, root: string): Promise<void> {
  const file = await gitPath(git, root, 'info/attributes');
  const current = await readFile(file, 'utf8').catch(() => '');
  if (current.split(/\r?\n/).some((line) => line.trim() === BYTE_EXACT_ATTRIBUTES)) return;
  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${current}${separator}${ATTRIBUTES_HEADER}\n${BYTE_EXACT_ATTRIBUTES}\n`);
}

/** Returns true when this call created the repository (the first commit follows). */
export async function prepareVaultRepository(git: GitRunner, root: string): Promise<boolean> {
  const created = !(await exists(path.join(root, '.git')));
  if (created) await git.run(['-c', 'init.defaultBranch=main', 'init', '-q']);
  await ensureIdentity(git);
  await ensureExcludeRules(git, root);
  await ensureByteExactAttributes(git, root);
  return created;
}
