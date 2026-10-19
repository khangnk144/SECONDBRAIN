import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openVault } from '../../src/vault/open-vault.js';
import { VAULT_FOLDERS } from '../../src/vault/vault-layout.js';
import type { VaultService } from '../../src/vault/vault-types.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';
import { expectVaultError, listTree } from './helpers/vault-test-kit.js';

const NOW = new Date('2026-10-18T08:30:00.000Z');
const STATE_LAYOUT = [
  '.secondbrain/',
  '.secondbrain/cache/',
  '.secondbrain/logs/',
  '.secondbrain/state/',
  '.secondbrain/state/drafts/',
  '.secondbrain/state/ingest/',
  '.secondbrain/state/journal/',
  '.secondbrain/trash/',
  '.secondbrain/vault.json',
];
const EXPECTED_TEMPLATES = [
  'Templates/Book.md',
  'Templates/Course project.md',
  'Templates/Course.md',
  'Templates/Daily.md',
  'Templates/Lecture.md',
  'Templates/Note.md',
  'Templates/Paper.md',
  'Templates/Research project.md',
];

describe('openVault on an empty folder (F1.1)', () => {
  let base: string;
  let root: string;
  let vault: VaultService | undefined;
  beforeEach(() => {
    base = makeTempDir('sb open Đồ án');
    root = path.join(base, 'vault');
  });
  afterEach(async () => {
    await vault?.close();
    removeDir(base);
  });

  it('creates exactly the folders, templates, CLAUDE.md and the state layout', async () => {
    mkdirSync(root);
    const result = await openVault({ root, now: () => NOW });
    vault = result.vault;
    const expected = [
      ...STATE_LAYOUT,
      'CLAUDE.md',
      ...VAULT_FOLDERS.map((folder) => `${folder}/`),
      ...EXPECTED_TEMPLATES,
    ].sort();
    expect(listTree(root)).toEqual(expected);
    expect([...result.created].sort()).toEqual(
      [...VAULT_FOLDERS, ...EXPECTED_TEMPLATES, 'CLAUDE.md'].sort(),
    );
    const identity = JSON.parse(readFileSync(path.join(root, '.secondbrain/vault.json'), 'utf8'));
    expect(identity).toEqual({ id: vault.id, createdAt: NOW.toISOString() });
    expect(vault.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(vault.paths.journalDir).toBe(path.join(vault.root, '.secondbrain', 'state', 'journal'));
  });

  it('creates nothing on a second open and keeps the vault id', async () => {
    const first = await openVault({ root });
    const id = first.vault.id;
    await first.vault.close();
    const before = listTree(root);
    const second = await openVault({ root });
    vault = second.vault;
    expect(second.created).toEqual([]);
    expect(vault.id).toBe(id);
    expect(listTree(root)).toEqual(before);
  });

  it('creates the vault folder itself when only its parent exists', async () => {
    vault = (await openVault({ root })).vault;
    expect(listTree(root)).toContain('0 Inbox/');
  });

  it('refuses a missing parent folder and a vault path that is a file', async () => {
    await expectVaultError(openVault({ root: path.join(base, 'missing', 'vault') }), 'NOT_FOUND');
    writeFileSync(path.join(base, 'file'), 'x');
    const details = await expectVaultError(
      openVault({ root: path.join(base, 'file') }),
      'INVALID_PATH',
    );
    expect(details.reason).toBe('not-a-folder');
  });

  it('stops on an unreadable vault.json instead of replacing the identity', async () => {
    mkdirSync(path.join(root, '.secondbrain'), { recursive: true });
    writeFileSync(path.join(root, '.secondbrain/vault.json'), '{ broken');
    await expectVaultError(openVault({ root }), 'VALIDATION');
    expect(readFileSync(path.join(root, '.secondbrain/vault.json'), 'utf8')).toBe('{ broken');
  });

  it('removes leftover atomic-write temp files but keeps interim rename names and user files', async () => {
    mkdirSync(path.join(root, '0 Inbox'), { recursive: true });
    mkdirSync(path.join(root, '.secondbrain/state/journal'), { recursive: true });
    const leftovers = [
      '0 Inbox/.Ghi chú.md.0123456789ab.tmp',
      '.secondbrain/state/journal/.x.json.abcdefabcdef.tmp',
    ];
    const kept = [
      '0 Inbox/.Ghi chú.md.0123456789ab.renaming',
      '0 Inbox/.backup.tmp',
      '0 Inbox/a.md',
    ];
    for (const file of [...leftovers, ...kept]) writeFileSync(path.join(root, file), 'x');
    vault = (await openVault({ root })).vault;
    const tree = listTree(root);
    for (const file of leftovers) expect(tree).not.toContain(file);
    for (const file of kept) expect(tree).toContain(file);
  });

  it('treats a case variant of a standard folder as present', async () => {
    mkdirSync(path.join(root, '0 inbox'), { recursive: true });
    const result = await openVault({ root });
    vault = result.vault;
    expect(result.created).not.toContain('0 Inbox');
    expect(listTree(root)).not.toContain('0 Inbox/');
  });
});
