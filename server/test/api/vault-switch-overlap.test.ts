import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkSwitchTarget } from '../../src/app-context/vault-switch-target.js';
import { multipartBody } from '../helpers/backup-test-helpers.js';
import { authHeaders, makeTempDir, removeDir } from '../helpers/test-environment.js';
import { createVaultTestApp, q, type VaultTestApp } from './vault-test-app.js';

const PORT = 47601;
const NOTE = '1 Projects/Đồ án.md';

describe('a vault never opens inside, around or as a copy of the open vault (F18.3)', () => {
  let t: VaultTestApp;
  let outside: string;
  let zip: Buffer;

  // The open vault is B, outside the install home, so "the folder around it" holds no app folder.
  let vaultB: string;

  beforeAll(async () => {
    outside = makeTempDir('sb ngoài kho lồng');
    t = await createVaultTestApp(PORT);
    vaultB = path.join(outside, 'Kho B');
    mkdirSync(path.join(vaultB, '1 Projects', 'Môn học'), { recursive: true });
    writeFileSync(path.join(vaultB, NOTE), '# Đồ án\n');
    const opened = await t.call('POST', '/api/vault/switch', { path: vaultB });
    expect(opened.statusCode, opened.body).toBe(200);
    vaultB = t.context.vault.root;
    zip = (await t.call('POST', '/api/backup/export')).rawPayload;
  });
  afterAll(async () => {
    await t?.close();
    if (outside) removeDir(outside);
  });

  const switchTo = (target: string) => t.call('POST', '/api/vault/switch', { path: target });

  it.each([
    ['a folder inside it', () => path.join(vaultB, '1 Projects')],
    ['a deeper folder inside it', () => path.join(vaultB, '1 Projects', 'Môn học')],
    ['a missing folder inside it', () => path.join(vaultB, '1 Projects', 'Chưa có')],
    ['the folder around it', () => path.dirname(vaultB)],
  ])('switching to %s is refused (overlaps-vault) and writes nothing', async (_label, target) => {
    const folder = target();
    const before = existsSync(folder) ? readdirSync(folder).sort() : null;
    const res = await switchTo(folder);
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'VAULT_UNUSABLE',
      details: { reason: 'overlaps-vault' },
    });
    expect(existsSync(folder) ? readdirSync(folder).sort() : null).toEqual(before);
    expect(existsSync(path.join(vaultB, '1 Projects', '.secondbrain'))).toBe(false);
    expect(t.context.vault.root).toBe(vaultB);
    expect((await t.call('GET', `/api/note?${q(NOTE)}`)).statusCode).toBe(200);
  });

  it('a link that leads into the open vault is refused too (real paths are compared)', async () => {
    const link = path.join(outside, 'lối tắt tới dự án');
    symlinkSync(path.join(vaultB, '1 Projects'), link, 'dir');
    const res = await switchTo(link);
    expect(res.json().error.details.reason).toBe('overlaps-vault');
    expect(existsSync(path.join(vaultB, '1 Projects', '.secondbrain'))).toBe(false);
  });

  it('the open vault itself still answers at once (nothing reopens)', async () => {
    const res = await switchTo(vaultB);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ vaultId: t.context.vault.id, path: vaultB });
  });

  it('on Windows the comparison ignores letter case', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    try {
      const spelled = path.join(vaultB.toUpperCase(), '1 PROJECTS');
      await expect(
        checkSwitchTarget(spelled, { allowMissing: false, protectedDirs: [], openVault: vaultB }),
      ).rejects.toMatchObject({ code: 'VAULT_UNUSABLE', details: { reason: 'overlaps-vault' } });
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  });

  function restore(target: string) {
    const body = multipartBody(
      [
        ['target', target],
        ['open', 'false'],
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
      },
      payload: body.payload,
    });
  }

  it.each([
    ['inside the open vault', () => path.join(vaultB, '0 Inbox', 'khôi phục')],
    ['the open vault itself', () => vaultB],
    ['around the open vault', () => path.dirname(vaultB)],
  ])('a restore target %s is refused (target-inside-vault)', async (_label, target) => {
    const res = await restore(target());
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'target-inside-vault' },
    });
    expect(existsSync(path.join(vaultB, '0 Inbox', 'khôi phục'))).toBe(false);
  });
});
