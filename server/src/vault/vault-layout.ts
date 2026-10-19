import path from 'node:path';
import { isAtomicTempName } from '../fs/atomic-write-file.js';
import { BUNDLED_TEMPLATES } from '../templates/bundled-templates.js';
import type { VaultPath, VaultStatePaths } from './vault-types.js';

/** Per-vault app state folder at the vault root (never reachable through vault paths). */
export const APP_DIR_NAME = '.secondbrain';

/** Standard folders created on open when absent (SPEC §3), parents before children. */
export const VAULT_FOLDERS: readonly VaultPath[] = [
  '0 Inbox',
  '1 Projects',
  '2 Areas',
  '3 Resources',
  '3 Resources/papers',
  '3 Resources/slides',
  '3 Resources/web',
  '3 Resources/other',
  '4 Archive',
  'wiki',
  'wiki/papers',
  'wiki/concepts',
  'wiki/research-gaps',
  'Daily',
  'Templates',
  'Attachments',
];

export const TEMPLATES_FOLDER = 'Templates';
export const TEMPLATE_PATHS: readonly VaultPath[] = BUNDLED_TEMPLATES.map(
  (template) => `${TEMPLATES_FOLDER}/${template.name}`,
);
export const CLAUDE_MD_PATH: VaultPath = 'CLAUDE.md';

export function buildStatePaths(root: string): VaultStatePaths {
  const appDir = path.join(root, APP_DIR_NAME);
  const stateDir = path.join(appDir, 'state');
  return {
    appDir,
    vaultFile: path.join(appDir, 'vault.json'),
    cacheDir: path.join(appDir, 'cache'),
    stateDir,
    journalDir: path.join(stateDir, 'journal'),
    draftsDir: path.join(stateDir, 'drafts'),
    ingestDir: path.join(stateDir, 'ingest'),
    trashDir: path.join(appDir, 'trash'),
    logsDir: path.join(appDir, 'logs'),
    eventsFile: path.join(stateDir, 'events.jsonl'),
    sampleFile: path.join(stateDir, 'sample.json'),
  };
}

/** Folders of the empty state layout, created on open. */
export function stateLayoutDirs(paths: VaultStatePaths): string[] {
  return [
    paths.cacheDir,
    paths.journalDir,
    paths.draftsDir,
    paths.ingestDir,
    paths.trashDir,
    paths.logsDir,
  ];
}

/**
 * Interim name of a case-only/NFC-only rename: short and fixed-length (`.sb-<12 hex>.renaming`) so
 * it fits next to a name of the maximum length; the older `.<name>.<12 hex>.renaming` form is still
 * recognised for entries written by earlier versions.
 */
const RENAME_TEMP_NAME = /^\.sb-[0-9a-f]{12}\.renaming$/;
const LEGACY_RENAME_TEMP_NAME = /^\..+\.[0-9a-f]{12}\.renaming$/;

/**
 * True for names the vault service itself creates transiently: atomic-write temp files (removed on
 * open when left over) and the interim name of a two-step rename (finished or undone through the
 * journal). Listings and the watcher ignore both.
 */
export function isVaultTempFileName(name: string): boolean {
  return (
    isAtomicTempName(name) || RENAME_TEMP_NAME.test(name) || LEGACY_RENAME_TEMP_NAME.test(name)
  );
}

export function renameTempName(hex12: string): string {
  return `.sb-${hex12}.renaming`;
}
