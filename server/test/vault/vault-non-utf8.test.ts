import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RelinkPlanner } from '../../src/vault/vault-types.js';
import {
  expectVaultError,
  openTempVault,
  sha256,
  type TempVault,
} from './helpers/vault-test-kit.js';

/** Windows-1258 style bytes: 0xFA and 0xE0 alone are not valid UTF-8. */
const ANSI = Buffer.concat([
  Buffer.from('Ghi ch'),
  Buffer.from([0xfa]),
  Buffer.from(' v'),
  Buffer.from([0xe0]),
  Buffer.from(' xem [[Target]]\r\n'),
]);
const ANSI_PATH = '0 Inbox/ansi.md';

describe('notes that are not UTF-8 are never rewritten', () => {
  let t: TempVault;
  const onDisk = () => readFileSync(path.join(t.root, '0 Inbox', 'ansi.md'));
  beforeEach(async () => {
    t = await openTempVault();
    writeFileSync(path.join(t.root, '0 Inbox', 'ansi.md'), ANSI);
  });
  afterEach(() => t.cleanup());

  it('read flags them (a BOM is still UTF-8)', async () => {
    const ansi = await t.vault.read(ANSI_PATH);
    expect(ansi.utf8).toBe(false);
    expect(ansi.revision).toBe(sha256(ANSI));
    expect(ansi.content).toContain('�');
    await t.vault.create('0 Inbox/bom.md', '﻿# Có BOM\r\n');
    expect((await t.vault.read('0 Inbox/bom.md')).utf8).toBe(true);
  });

  it('write and patch refuse with VALIDATION not-utf8 and leave the bytes alone', async () => {
    const { revision, content } = await t.vault.read(ANSI_PATH);
    const write = await expectVaultError(t.vault.write(ANSI_PATH, content, revision), 'VALIDATION');
    expect(write).toEqual({ path: ANSI_PATH, reason: 'not-utf8' });
    const patch = await expectVaultError(
      t.vault.patch(ANSI_PATH, [{ start: 0, end: 3, text: 'Ghi' }], revision),
      'VALIDATION',
    );
    expect(patch).toEqual({ path: ANSI_PATH, reason: 'not-utf8' });
    expect(onDisk()).toEqual(ANSI);
  });

  it('a stale revision is still reported as CONFLICT first', async () => {
    await expectVaultError(t.vault.write(ANSI_PATH, 'x', sha256('old')), 'CONFLICT');
  });

  it('relink skips them even when a planner proposes an edit, and says so', async () => {
    const target = await t.vault.create('0 Inbox/Target.md', 'target\n');
    const linking = await t.vault.create('0 Inbox/b.md', 'xem [[Target]]\n');
    const planner: RelinkPlanner = {
      plan: async () => [
        { path: ANSI_PATH, expectedRevision: sha256(ANSI), newContent: 'xem [[Renamed]]\r\n' },
        { path: linking.path, expectedRevision: linking.revision, newContent: 'xem [[Renamed]]\n' },
      ],
    };
    t.vault.setRelinkPlanner(planner);
    const result = await t.vault.rename(target.path, '0 Inbox/Renamed.md', {
      expectedRevision: target.revision,
      relink: true,
    });
    expect(result.affected).toEqual([linking.path]);
    expect(result.skipped).toEqual([ANSI_PATH]);
    expect(onDisk()).toEqual(ANSI);
    expect((await t.vault.read(linking.path)).content).toBe('xem [[Renamed]]\n');
  });

  it('skipped notes reported by the planner are passed through; none → no field', async () => {
    const target = await t.vault.create('0 Inbox/Target.md', 'target\n');
    t.vault.setRelinkPlanner({ plan: async () => ({ edits: [], skipped: [ANSI_PATH] }) });
    const first = await t.vault.rename(target.path, '0 Inbox/A.md', {
      expectedRevision: target.revision,
      relink: true,
    });
    expect(first.skipped).toEqual([ANSI_PATH]);
    t.vault.setRelinkPlanner({ plan: async () => ({ edits: [], skipped: [] }) });
    const second = await t.vault.rename(first.path, '0 Inbox/B.md', {
      expectedRevision: target.revision,
      relink: true,
    });
    expect(second).not.toHaveProperty('skipped');
  });
});
