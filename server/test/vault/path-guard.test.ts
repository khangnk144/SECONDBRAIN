import { mkdirSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guardVaultPath } from '../../src/security/path-guard.js';
import { isVaultError } from '../../src/vault/vault-types.js';
import {
  expectVaultError,
  openTempVault,
  sha256,
  type TempVault,
} from './helpers/vault-test-kit.js';

/** [input, reason] – every case the guard must refuse. */
const REFUSED: [string, string][] = [
  ['', 'empty'],
  ['a\0b.md', 'nul'],
  ['a\u0001b.md', 'control-char'],
  ['notes/\ttab.md', 'control-char'],
  ['/etc/passwd', 'absolute'],
  ['\\Windows\\win.ini', 'absolute'],
  ['C:', 'absolute'],
  ['C:\\Users\\x.md', 'absolute'],
  ['c:/Users/x.md', 'absolute'],
  ['d:x.md', 'absolute'],
  ['//server/share/x.md', 'unc'],
  ['\\\\server\\share\\x.md', 'unc'],
  ['../x.md', 'dotdot'],
  ['0 Inbox/../../x.md', 'dotdot'],
  ['0 Inbox\\..\\x.md', 'dotdot'],
  ['./x.md', 'dot-segment'],
  ['0 Inbox/./x.md', 'dot-segment'],
  ['0 Inbox//x.md', 'empty-segment'],
  ['0 Inbox/', 'empty-segment'],
  ['a<b.md', 'invalid-char'],
  ['a>b.md', 'invalid-char'],
  ['note.md:secret', 'invalid-char'],
  ['a"b.md', 'invalid-char'],
  ['a|b.md', 'invalid-char'],
  ['a?.md', 'invalid-char'],
  ['*.md', 'invalid-char'],
  ['CON', 'reserved-name'],
  ['con.md', 'reserved-name'],
  ['Lpt1.txt', 'reserved-name'],
  ['nul', 'reserved-name'],
  ['aux.tar.gz', 'reserved-name'],
  ['COM9.md', 'reserved-name'],
  ['2 Areas/prn/x.md', 'reserved-name'],
  ['con .md', 'reserved-name'],
  ['ghi chú.', 'trailing-dot-or-space'],
  ['ghi chú ', 'trailing-dot-or-space'],
  ['0 Inbox /x.md', 'trailing-dot-or-space'],
  ['folder./x.md', 'trailing-dot-or-space'],
  [`${'a'.repeat(253)}.md`, 'too-long'],
  ['.secondbrain/vault.json', 'internal-folder'],
  ['.SecondBrain/state/sample.json', 'internal-folder'],
  ['.git/config', 'internal-folder'],
  ['.GIT/HEAD', 'internal-folder'],
];

const ACCEPTED: [string, string][] = [
  ['0 Inbox/Ghi chú.md', '0 Inbox/Ghi chú.md'],
  ['1 Projects\\Đồ án Giải tích.md', '1 Projects/Đồ án Giải tích.md'],
  ['%2e%2e/x.md', '%2e%2e/x.md'],
  ['Ghi chú.md'.normalize('NFD'), 'Ghi chú.md'],
  ['.obsidian/app.json', '.obsidian/app.json'],
  ['wiki/.secondbrain/x.md', 'wiki/.secondbrain/x.md'],
  ['CONSOLE.md', 'CONSOLE.md'],
  ['com10.md', 'com10.md'],
  ['x..y.md', 'x..y.md'],
  [`${'a'.repeat(252)}.md`, `${'a'.repeat(252)}.md`],
];

describe('guardVaultPath syntax rules (F1.5)', () => {
  it.each(REFUSED)('refuses %j as %s', (input, reason) => {
    try {
      guardVaultPath(input);
      expect.unreachable('the guard accepted the path');
    } catch (error) {
      expect(isVaultError(error) && error.code).toBe('INVALID_PATH');
      expect(isVaultError(error) && error.details).toMatchObject({ path: input, reason });
    }
  });

  it.each(ACCEPTED)('accepts %j as %j', (input, expected) => {
    expect(guardVaultPath(input)).toBe(expected);
  });
});

describe('path guard on every vault operation (F1.5)', () => {
  let t: TempVault;
  beforeEach(async () => {
    t = await openTempVault();
  });
  afterEach(() => t.cleanup());

  const bad = REFUSED.map(([input]) => input);
  const revision = sha256('');

  it.each(bad)('every operation refuses %j with INVALID_PATH', async (input) => {
    const { vault } = t;
    await vault.create('0 Inbox/ok.md', '');
    const ops: (() => Promise<unknown>)[] = [
      () => vault.read(input),
      () => vault.readBytes(input),
      () => vault.stat(input),
      () => vault.resolveExisting(input),
      () => vault.create(input, 'x'),
      () => vault.createUnique(input, 'x'),
      () => vault.createFolder(input),
      () => vault.write(input, 'x', revision),
      () => vault.patch(input, [{ start: 0, end: 0, text: 'x' }], revision),
      () => vault.rename('0 Inbox/ok.md', input, { expectedRevision: revision, relink: false }),
      () => vault.trash([input], [revision]),
    ];
    if (input !== '') {
      ops.push(() =>
        vault.move('0 Inbox/ok.md', input, { expectedRevision: revision, relink: false }),
      );
    }
    for (const op of ops) await expectVaultError(op(), 'INVALID_PATH');
  });

  it('refuses reads and writes through a symlink that points outside the vault', async () => {
    const outside = path.join(t.base, 'ngoài kho');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'bí mật.md'), 'secret');
    symlinkSync(outside, path.join(t.root, 'liên kết'), 'dir');
    symlinkSync(path.join(outside, 'bí mật.md'), path.join(t.root, 'leak.md'), 'file');
    const { vault } = t;
    const created = await vault.create('0 Inbox/a.md', 'a');
    for (const op of [
      () => vault.read('liên kết/bí mật.md'),
      () => vault.readBytes('leak.md'),
      () => vault.resolveExisting('leak.md'),
      () => vault.create('liên kết/new.md', 'x'),
      () => vault.createFolder('liên kết/sub'),
      () => vault.write('leak.md', 'x', sha256('secret')),
      () =>
        vault.rename('0 Inbox/a.md', 'liên kết/a.md', {
          expectedRevision: created.revision,
          relink: false,
        }),
    ]) {
      const details = await expectVaultError(op(), 'INVALID_PATH');
      expect(details.reason).toBe('outside-vault');
    }
    expect(existsSync(path.join(outside, 'new.md'))).toBe(false);
    expect(existsSync(path.join(outside, 'a.md'))).toBe(false);
    const listing = await vault.list();
    expect(listing.files.map((f) => f.path)).not.toContain('leak.md');
    expect(listing.folders).not.toContain('liên kết');
  });

  it('refuses a link inside the vault that leads into the internal state folder', async () => {
    symlinkSync(path.join(t.root, '.secondbrain'), path.join(t.root, 'alias'), 'dir');
    const details = await expectVaultError(t.vault.read('alias/vault.json'), 'INVALID_PATH');
    expect(details.reason).toBe('internal-folder');
  });

  it.runIf(process.platform === 'win32')('refuses a junction pointing outside', async () => {
    const outside = path.join(t.base, 'junction target');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'x.md'), 'x');
    symlinkSync(outside, path.join(t.root, 'junction'), 'junction');
    await expectVaultError(t.vault.read('junction/x.md'), 'INVALID_PATH');
  });
});
