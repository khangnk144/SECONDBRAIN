import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { revealCommand, spawnDetached, type RevealCommand } from '../../src/api/reveal-command.js';
import { createVaultTestApp, type VaultTestApp } from './vault-test-app.js';

const PORT = 4826;

describe('reveal command per platform (never through a shell)', () => {
  it('Windows: explorer.exe with the quoted path passed verbatim (spaces and commas stay inside)', () => {
    const file = 'C:\\Kho ghi chú\\0 Inbox\\Bài 1, phần 2.md';
    expect(revealCommand('win32', file)).toEqual({
      command: 'explorer.exe',
      args: ['/select,"C:\\Kho ghi chú\\0 Inbox\\Bài 1, phần 2.md"'],
      windowsVerbatimArguments: true,
    });
  });

  it('macOS selects in Finder; other systems open the parent folder', () => {
    expect(revealCommand('darwin', '/Users/k/Kho/a b.md')).toEqual({
      command: 'open',
      args: ['-R', '/Users/k/Kho/a b.md'],
    });
    expect(revealCommand('linux', '/home/k/Kho/0 Inbox/a b.md')).toEqual({
      command: 'xdg-open',
      args: ['/home/k/Kho/0 Inbox'],
    });
  });

  it('the default launcher reports a missing program instead of throwing', async () => {
    const code = await new Promise<string>((resolve) =>
      spawnDetached(resolve)({ command: 'sb-no-such-file-manager', args: ['x'] }),
    );
    expect(code).toBe('ENOENT');
  });
});

describe('POST /api/reveal', () => {
  let t: VaultTestApp;
  const calls: RevealCommand[] = [];

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      watcher: false,
      vaultRoutes: { reveal: { spawn: (command) => calls.push(command), platform: 'win32' } },
      seed: (root) => {
        mkdirSync(path.join(root, '0 Inbox'), { recursive: true });
        writeFileSync(path.join(root, '0 Inbox', 'Ghi chú, nháp.md'), 'x');
      },
    });
  });
  afterAll(async () => t?.close());

  it('opens the file manager at an existing file or folder and answers 204', async () => {
    const res = await t.call('POST', '/api/reveal', { path: '0 Inbox/Ghi chú, nháp.md' });
    expect(res.statusCode, res.body).toBe(204);
    expect(res.body).toBe('');
    const file = path.join(t.vaultRoot, '0 Inbox', 'Ghi chú, nháp.md');
    expect(calls).toEqual([revealCommand('win32', file)]);
    expect((await t.call('POST', '/api/reveal', { path: '1 Projects' })).statusCode).toBe(204);
    expect(calls[1]!.args).toEqual([`/select,"${path.join(t.vaultRoot, '1 Projects')}"`]);
  });

  it('a missing path is 404 and a refused path is 400; nothing is launched', async () => {
    calls.length = 0;
    const missing = await t.call('POST', '/api/reveal', { path: '0 Inbox/Không có.md' });
    expect([missing.statusCode, missing.json().error.code]).toEqual([404, 'NOT_FOUND']);
    for (const bad of ['../ngoài.md', '.secondbrain/vault.json', 'C:\\Windows', '0 Inbox/a?.md']) {
      const res = await t.call('POST', '/api/reveal', { path: bad });
      expect([res.statusCode, res.json().error.code]).toEqual([400, 'INVALID_PATH']);
    }
    expect(calls).toEqual([]);
  });
});
