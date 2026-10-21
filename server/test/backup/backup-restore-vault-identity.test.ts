import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { multipartBody, readTree } from '../helpers/backup-test-helpers.js';
import { authHeaders, makeTempDir, removeDir } from '../helpers/test-environment.js';
import { createVaultTestApp, q, type VaultTestApp } from '../api/vault-test-app.js';

const PORT = 47600;
const NOTE = '1 Projects/Bài 1.md';
const VAULT_FILE = '.secondbrain/vault.json';
const REMINDERS_FILE = '.secondbrain/state/reminders.json';
const remindersJson = (vaultId: string) =>
  `${JSON.stringify(
    {
      version: 1,
      entries: [
        {
          key: `${vaultId}|note:${NOTE}|2026-11-05|3`,
          itemId: `note:${NOTE}`,
          path: NOTE,
          title: 'Bài 1',
          due: '2026-11-05',
          threshold: 3,
          firedAt: '2026-11-02T01:00:00.000Z',
          missed: false,
          toast: 'shown',
          dismissed: true,
        },
      ],
      superseded: [
        { key: `${vaultId}|note:${NOTE}|2026-11-05|1`, recordedAt: '2026-11-02T01:00:00.000Z' },
      ],
    },
    null,
    2,
  )}\n`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const idIn = (folder: string) =>
  (JSON.parse(readFileSync(path.join(folder, ...VAULT_FILE.split('/')), 'utf8')) as { id: string })
    .id;

describe('a restored backup is a new vault with its own id (F18.5)', () => {
  let t: VaultTestApp;
  let outside: string;
  let zip: Buffer;
  let idA: string;

  beforeAll(async () => {
    outside = makeTempDir('sb khôi phục mã kho');
    t = await createVaultTestApp(PORT, {
      seed: (root) => {
        mkdirSync(path.join(root, '1 Projects'), { recursive: true });
        writeFileSync(path.join(root, NOTE), '# Bài 1\n\nv1\n');
      },
    });
    idA = t.context.vault.id;
    // What the reminder plugin had recorded before the backup (no plugin runs in this app).
    writeFileSync(path.join(t.vaultRoot, ...REMINDERS_FILE.split('/')), remindersJson(idA));
    const exported = await t.call('POST', '/api/backup/export');
    expect(exported.statusCode, exported.body).toBe(200);
    zip = exported.rawPayload;
  });
  afterAll(async () => {
    await t?.close();
    if (outside) removeDir(outside);
  });

  function restore(target: string, open: boolean, vaultId = idA) {
    const body = multipartBody(
      [
        ['target', target],
        ['open', String(open)],
      ],
      { data: zip },
    );
    return t.app.inject({
      method: 'POST',
      url: '/api/backup/restore',
      headers: {
        ...authHeaders(PORT),
        origin: `http://localhost:${PORT}`,
        'content-type': body.contentType,
        'x-sb-vault-id': vaultId,
      },
      payload: body.payload,
    });
  }

  it('restoring without opening writes a fresh id; every other byte is as backed up', async () => {
    const target = path.join(outside, 'Chưa mở');
    const res = await restore(target, false);
    expect(res.statusCode, res.body).toBe(201);
    const idR = res.json().vaultId as string;
    expect(idR).toMatch(UUID);
    expect(idR).not.toBe(idA);
    expect(idIn(target)).toBe(idR);

    const original = JSON.parse(
      readFileSync(path.join(t.vaultRoot, ...VAULT_FILE.split('/')), 'utf8'),
    );
    const restored = JSON.parse(readFileSync(path.join(target, ...VAULT_FILE.split('/')), 'utf8'));
    expect(restored).toEqual({ ...original, id: idR });
    const notInBackup = (relative: string) =>
      /^\.secondbrain\/(cache|logs)(\/|$)/.test(relative) || /^\.git(\/|$)/.test(relative);
    const before = readTree(t.vaultRoot, notInBackup);
    const after = readTree(target);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [name, bytes] of before) {
      if (name !== VAULT_FILE && name !== REMINDERS_FILE) {
        expect(after.get(name)?.equals(bytes), name).toBe(true);
      }
    }
    // What was already reminded stays reminded in the copy: the keys move to its new id.
    expect(readFileSync(path.join(target, ...REMINDERS_FILE.split('/')), 'utf8')).toBe(
      remindersJson(idR),
    );
  });

  it('after "restore and open" a stale window of the original vault gets 409, not the copy', async () => {
    const vaultA = t.vaultRoot;
    const baseRevision = (await t.call('GET', `/api/note?${q(NOTE)}`)).json().revision as string;
    const target = path.join(outside, 'Khôi phục thử');
    const res = await restore(target, true);
    expect(res.statusCode, res.body).toBe(201);
    const idR = res.json().vaultId as string;
    expect(idR).not.toBe(idA);
    expect(t.context.vault.root).toBe(res.json().path);
    expect(t.context.vault.id).toBe(idR);
    expect(idIn(target)).toBe(idR);

    // A second window still shows vault A (it missed the switch event) and autosaves.
    const save = await t.app.inject({
      method: 'PUT',
      url: '/api/note',
      headers: {
        ...authHeaders(PORT),
        origin: `http://localhost:${PORT}`,
        'content-type': 'application/json',
        'x-sb-vault-id': idA,
      },
      payload: {
        path: NOTE,
        content: '# Bài 1\n\nv1\nGõ ở cửa sổ 2 (cho kho A)\n',
        expectedRevision: baseRevision,
      },
    });
    expect(save.statusCode, save.body).toBe(409);
    expect(save.json().error.details.reason).toBe('vault-switched');
    expect(readFileSync(path.join(target, NOTE), 'utf8')).toBe('# Bài 1\n\nv1\n');
    expect(readFileSync(path.join(vaultA, NOTE), 'utf8')).toBe('# Bài 1\n\nv1\n');
  });
});
