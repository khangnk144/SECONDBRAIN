import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RevealCommand } from '../../src/api/reveal-command.js';
import { createVaultTestApp, createMemoryLogger, q, type VaultTestApp } from './vault-test-app.js';

const PORT = 47616;

describe('POST /api/logs/reveal ("Mở thư mục log")', () => {
  let t: VaultTestApp;
  const launched: RevealCommand[] = [];
  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      logger: createMemoryLogger(),
      vaultRoutes: {
        reveal: { spawn: (command) => void launched.push(command), platform: 'win32' },
      },
    });
  });
  afterAll(async () => t?.close());

  it('opens the vault log folder in Explorer with the current log selected; 204, nothing returned', async () => {
    const logsDir = t.context.vault.paths.logsDir;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path.join(logsDir, 'app.log'), 'line\n');
    const res = await t.call('POST', '/api/logs/reveal');
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(launched.at(-1)).toEqual({
      command: 'explorer.exe',
      args: [`/select,"${path.join(logsDir, 'app.log')}"`],
      windowsVerbatimArguments: true,
    });
  });

  it('without a log file yet it shows the folder itself', async () => {
    rmSync(path.join(t.context.vault.paths.logsDir, 'app.log'), { force: true });
    expect((await t.call('POST', '/api/logs/reveal')).statusCode).toBe(204);
    expect(launched.at(-1)?.args).toEqual([`/select,"${t.context.vault.paths.logsDir}"`]);
  });

  it('the logs stay out of reach of the file routes', async () => {
    const res = await t.call('GET', `/api/files?${q('.secondbrain/logs/app.log')}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_PATH');
  });
});
