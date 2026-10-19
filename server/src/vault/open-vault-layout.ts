import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { atomicCreateFile, isAtomicTempName } from '../fs/atomic-write-file.js';
import { assertInsideVault } from '../security/path-guard.js';
import { BUNDLED_TEMPLATES } from '../templates/bundled-templates.js';
import { CLAUDE_MD_SKELETON } from '../templates/claude-md-skeleton.js';
import { createFailureTally } from './housekeeping-tally.js';
import { writeStateJson, type VaultWarning } from './vault-core.js';
import { locate } from './vault-disk-names.js';
import { readIfFile } from './vault-file-state.js';
import { CLAUDE_MD_PATH, TEMPLATES_FOLDER, VAULT_FOLDERS } from './vault-layout.js';
import { isVaultError, VaultError, type VaultPath, type VaultStatePaths } from './vault-types.js';

export async function ensureRootFolder(root: string): Promise<void> {
  try {
    if ((await stat(root)).isDirectory()) return;
    throw new VaultError('INVALID_PATH', 'The vault path is not a folder', {
      path: root,
      reason: 'not-a-folder',
    });
  } catch (error) {
    if (isVaultError(error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    // Not recursive: a missing parent usually means a mistyped path, not a wish for new folders.
    await mkdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new VaultError('NOT_FOUND', 'The folder that should contain the vault does not exist', {
      path: path.dirname(root),
    });
  }
}

/**
 * The vault identity is durable: an unreadable vault.json stops the open instead of replacing it.
 * `isNew` = the vault is being initialized now (no vault.json yet).
 */
export async function readOrCreateIdentity(
  paths: VaultStatePaths,
  now: () => Date,
): Promise<{ id: string; isNew: boolean }> {
  const bytes = await readIfFile(paths.vaultFile);
  if (!bytes) {
    const id = randomUUID();
    await writeStateJson(paths, paths.vaultFile, { id, createdAt: now().toISOString() });
    return { id, isNew: true };
  }
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as { id?: unknown };
    if (typeof parsed.id === 'string' && parsed.id !== '') return { id: parsed.id, isNew: false };
  } catch {
    // Falls through to the error below.
  }
  throw new VaultError(
    'VALIDATION',
    'The vault identity file .secondbrain/vault.json is unreadable',
    {
      path: '.secondbrain/vault.json',
    },
  );
}

/**
 * Best effort: removes atomic-write temp files a crash left behind (never the interim names of
 * renames, which the journal still needs). A file that cannot be removed is reported, not fatal.
 */
export async function removeLeftoverTempFiles(root: string, warn: VaultWarning): Promise<void> {
  const failures = createFailureTally();
  async function walk(dir: string, isRoot: boolean): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      failures.add(error);
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!(isRoot && entry.name.toLowerCase() === '.git')) await walk(abs, false);
      } else if (entry.isFile() && isAtomicTempName(entry.name)) {
        await rm(abs, { force: true }).catch((error: unknown) => failures.add(error));
      }
    }
  }
  await walk(root, true);
  failures.report(warn, 'remove leftover temp files');
}

/** Creates a standard folder or bundled file only when nothing (in any case/NFC variant) is there. */
async function createIfAbsent(
  root: string,
  vaultPath: VaultPath,
  content?: string,
): Promise<VaultPath | null> {
  let location;
  try {
    location = await locate(root, vaultPath, 'real');
    await assertInsideVault(root, location.abs, vaultPath);
  } catch (error) {
    // A parent is a file, or a link leads outside: leave the user's layout alone.
    if (isVaultError(error)) return null;
    throw error;
  }
  if (location.kind !== null) return null;
  try {
    if (content === undefined) await mkdir(location.abs);
    else await atomicCreateFile(location.abs, content);
  } catch (error) {
    // Created by someone else a moment ago: present is all that matters.
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw error;
  }
  return location.vaultPath;
}

/**
 * The standard folders (always, when missing) and — when the vault is being initialized — the
 * bundled templates and CLAUDE.md; a template the user deleted later stays deleted. One entry that
 * cannot be created (permissions on one folder) is reported and does not stop the vault opening.
 */
export async function createStandardEntries(
  root: string,
  includeBundled: boolean,
  warn: VaultWarning,
): Promise<VaultPath[]> {
  const bundled: [VaultPath, string][] = [
    ...BUNDLED_TEMPLATES.map((t): [VaultPath, string] => [
      `${TEMPLATES_FOLDER}/${t.name}`,
      t.content,
    ]),
    [CLAUDE_MD_PATH, CLAUDE_MD_SKELETON],
  ];
  const entries: [VaultPath, string | undefined][] = [
    ...VAULT_FOLDERS.map((folder): [VaultPath, undefined] => [folder, undefined]),
    ...(includeBundled ? bundled : []),
  ];
  const created: VaultPath[] = [];
  const failures = createFailureTally();
  for (const [vaultPath, content] of entries) {
    try {
      const made = await createIfAbsent(root, vaultPath, content);
      if (made) created.push(made);
    } catch (error) {
      failures.add(error, vaultPath);
    }
  }
  failures.report(warn, 'create standard folders and templates');
  return created;
}
