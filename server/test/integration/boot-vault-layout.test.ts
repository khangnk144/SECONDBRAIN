import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer } from '../../src/runtime/start-server.js';
import { snapshotTree } from '../api/vault-test-app.js';
import { makeFakeAppDir, makeTempDir, removeDir } from '../helpers/test-environment.js';

const PORT = 4794;

/** SPEC §3 folders + F14 templates + the CLAUDE.md skeleton: everything outside `.secondbrain/`. */
const EXPECTED_ENTRIES = [
  '0 Inbox',
  '1 Projects',
  '2 Areas',
  '3 Resources',
  '3 Resources/other',
  '3 Resources/papers',
  '3 Resources/slides',
  '3 Resources/web',
  '4 Archive',
  'Attachments',
  'CLAUDE.md',
  'Daily',
  'Templates',
  'Templates/Book.md',
  'Templates/Course project.md',
  'Templates/Course.md',
  'Templates/Daily.md',
  'Templates/Lecture.md',
  'Templates/Note.md',
  'Templates/Paper.md',
  'Templates/Research project.md',
  'wiki',
  'wiki/concepts',
  'wiki/papers',
  'wiki/research-gaps',
].sort();

describe('first start on an empty install creates exactly the vault layout (F1.1)', () => {
  let home: string;
  beforeEach(() => {
    home = makeTempDir('sb boot Đồ án');
  });
  afterEach(() => removeDir(home));

  it('lays out <home>/vault, reports the vault id on /api/health and logs inside the vault', async () => {
    const { appDir } = makeFakeAppDir(home);
    const result = await startServer({
      argv: ['--home', home, '--port', String(PORT)],
      env: {},
      appDir,
    });
    expect(result.kind).toBe('started');
    if (result.kind !== 'started') return;
    try {
      const vaultRoot = path.join(home, 'vault');
      const outside = Object.keys(
        snapshotTree(vaultRoot, (rel) => rel.startsWith('.secondbrain')),
      ).sort();
      expect(outside).toEqual(EXPECTED_ENTRIES);
      const identity = JSON.parse(
        readFileSync(path.join(vaultRoot, '.secondbrain', 'vault.json'), 'utf8'),
      );
      expect(identity).toEqual({ id: expect.any(String), createdAt: expect.any(String) });

      const health = await result.app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { host: `localhost:${PORT}` },
      });
      expect(health.json()).toMatchObject({ ok: true, vaultId: identity.id });

      result.logger.info('probe line');
      const vaultLog = readFileSync(
        path.join(vaultRoot, '.secondbrain', 'logs', 'app.log'),
        'utf8',
      );
      expect(vaultLog).toContain('probe line');
      const globalLog = readFileSync(path.join(home, '.secondbrain', 'logs', 'server.log'), 'utf8');
      expect(globalLog).toContain('further log lines go to');
      expect(globalLog).not.toContain('probe line');
    } finally {
      await result.stop();
    }
    // A second start opens the same vault: same id, nothing new created.
    const before = snapshotTree(path.join(home, 'vault'), (rel) => rel.startsWith('.secondbrain'));
    const again = await startServer({
      argv: ['--home', home, '--port', String(PORT)],
      env: {},
      appDir,
    });
    if (again.kind !== 'started') throw new Error(`unexpected ${again.kind}`);
    expect(again.context.vault.id).toBe(
      JSON.parse(readFileSync(path.join(home, 'vault', '.secondbrain', 'vault.json'), 'utf8')).id,
    );
    await again.stop();
    expect(snapshotTree(path.join(home, 'vault'), (rel) => rel.startsWith('.secondbrain'))).toEqual(
      before,
    );
  });

  it.each([
    [
      'its parent folder does not exist',
      (dir: string) => path.join(dir, 'missing parent', 'vault'),
    ],
    [
      'it is a file',
      (dir: string) => {
        writeFileSync(path.join(dir, 'vault-file'), 'not a folder');
        return path.join(dir, 'vault-file');
      },
    ],
  ])(
    'stops with a clear logged error when the vault folder cannot be used (%s)',
    async (_label, make) => {
      const { appDir } = makeFakeAppDir(home);
      const vaultPath = make(home);
      mkdirSync(path.join(home, '.secondbrain'), { recursive: true });
      writeFileSync(
        path.join(home, '.secondbrain', 'settings.json'),
        JSON.stringify({ vaultPath }),
      );
      const result = await startServer({
        argv: ['--home', home, '--port', String(PORT)],
        env: {},
        appDir,
      });
      expect(result).toMatchObject({ kind: 'vault-unusable', vaultRoot: vaultPath });
      const globalLog = readFileSync(path.join(home, '.secondbrain', 'logs', 'server.log'), 'utf8');
      expect(globalLog).toMatch(/ERROR The vault folder ".*" cannot be used/);
      expect(existsSync(path.join(home, '.secondbrain', 'server.json'))).toBe(false);
    },
  );

  it.each([
    ['the install root itself', '.'],
    ['the parent of the install', '..'],
    ['the global state folder', '.secondbrain'],
    ['a folder inside the global state', '.secondbrain/vault'],
    ['the app folder', 'app'],
    ['a folder inside the app folder', 'app/notes'],
  ])(
    'refuses a vault that overlaps the install (%s): no file is created',
    async (_label, vaultPath) => {
      const { appDir } = makeFakeAppDir(home);
      mkdirSync(path.join(home, '.secondbrain'), { recursive: true });
      writeFileSync(
        path.join(home, '.secondbrain', 'settings.json'),
        JSON.stringify({ vaultPath }),
      );
      const result = await startServer({
        argv: ['--home', home, '--port', String(PORT)],
        env: {},
        appDir,
      });
      expect(result).toMatchObject({
        kind: 'vault-unusable',
        vaultRoot: path.resolve(home, vaultPath),
      });
      const globalLog = readFileSync(path.join(home, '.secondbrain', 'logs', 'server.log'), 'utf8');
      expect(globalLog).toMatch(/ERROR The vault folder ".*" cannot be used: it overlaps/);
      const vaultRoot = path.resolve(home, vaultPath);
      for (const created of ['0 Inbox', 'Templates', 'CLAUDE.md', '.secondbrain/vault.json']) {
        expect(existsSync(path.join(vaultRoot, created)), created).toBe(false);
      }
      expect(existsSync(path.join(home, '.secondbrain', 'server.json'))).toBe(false);
    },
  );

  it('also refuses a vault inside the app folder when --home points elsewhere', async () => {
    const elsewhere = makeTempDir('sb app khác');
    try {
      const { appDir } = makeFakeAppDir(elsewhere);
      const vaultPath = path.join(appDir, 'ghi chú');
      mkdirSync(path.join(home, '.secondbrain'), { recursive: true });
      writeFileSync(
        path.join(home, '.secondbrain', 'settings.json'),
        JSON.stringify({ vaultPath }),
      );
      const result = await startServer({
        argv: ['--home', home, '--port', String(PORT)],
        env: {},
        appDir,
      });
      expect(result).toMatchObject({ kind: 'vault-unusable', vaultRoot: vaultPath });
      expect(existsSync(vaultPath)).toBe(false);
    } finally {
      removeDir(elsewhere);
    }
  });
});
