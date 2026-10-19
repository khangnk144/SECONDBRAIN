import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { realPath } from '../fs/real-path.js';
import { BUNDLED_TEMPLATES } from '../templates/bundled-templates.js';
import { pruneFinishedJournals } from './journal-store.js';
import {
  createStandardEntries,
  ensureRootFolder,
  readOrCreateIdentity,
  removeLeftoverTempFiles,
} from './open-vault-layout.js';
import type { VaultWarning } from './vault-core.js';
import type { VaultFaults } from './vault-faults.js';
import { buildStatePaths, stateLayoutDirs, TEMPLATES_FOLDER } from './vault-layout.js';
import { createVaultService } from './vault-service.js';
import { isVaultError, type VaultPath, type VaultService } from './vault-types.js';

export interface OpenVaultOptions {
  root: string;
  now?: () => Date;
  /** Test-only fault injection (see VaultFaults). */
  faults?: VaultFaults;
  /**
   * Problems that did not stop the vault (a locked leftover temp file, an old journal entry or
   * trash entry that could not be removed…): counts and error codes, never note content. Also
   * used later by the service (trash purge, damaged journal entries).
   */
  onWarning?: VaultWarning;
}

/** Finished journal entries (and their saved copies) are kept this long for undo and support. */
const FINISHED_JOURNAL_DAYS = 30;

/**
 * Opens (and on first run lays out) a vault: the root folder, `.secondbrain/vault.json` and the
 * empty state layout, the standard folders, and — when the vault is initialized (no vault.json
 * yet) — the bundled templates and `CLAUDE.md`. Only what is missing, never anything else, never
 * overwriting. Returns the vault paths it created (outside `.secondbrain/`). Housekeeping (temp
 * cleanup, journal pruning) is best effort. Unfinished journal entries stay pending for the user.
 */
export async function openVault(
  options: OpenVaultOptions,
): Promise<{ vault: VaultService; created: VaultPath[] }> {
  const now = options.now ?? (() => new Date());
  const warn: VaultWarning = (message, details) => {
    try {
      options.onWarning?.(message, details);
    } catch {
      // A failing reporter must not stop the vault from opening.
    }
  };
  const requested = path.resolve(options.root);
  await ensureRootFolder(requested);
  const root = await realPath(requested);
  const paths = buildStatePaths(root);
  for (const dir of stateLayoutDirs(paths)) await mkdir(dir, { recursive: true });
  const { id, isNew } = await readOrCreateIdentity(paths, now);
  await removeLeftoverTempFiles(root, warn);
  try {
    await pruneFinishedJournals({ paths, now }, FINISHED_JOURNAL_DAYS, warn);
  } catch (error) {
    warn(
      `Could not prune old journal entries (${(error as NodeJS.ErrnoException).code ?? 'ERROR'}).`,
    );
  }
  const created = await createStandardEntries(root, isNew, warn);
  const vault = createVaultService({ root, id, now, faults: options.faults, onWarning: warn });
  return { vault, created };
}

/** Settings "Khôi phục mẫu gốc": re-creates bundled templates that are missing, nothing else. */
export async function restoreMissingTemplates(vault: VaultService): Promise<VaultPath[]> {
  const created: VaultPath[] = [];
  for (const template of BUNDLED_TEMPLATES) {
    try {
      const result = await vault.create(`${TEMPLATES_FOLDER}/${template.name}`, template.content);
      created.push(result.path);
    } catch (error) {
      if (!(isVaultError(error) && error.code === 'EXISTS')) throw error;
    }
  }
  return created;
}
