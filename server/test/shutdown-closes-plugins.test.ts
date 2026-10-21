import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VaultPlugin } from '../src/app-context/vault-plugins.js';
import { startServer } from '../src/runtime/start-server.js';
import { makeFakeAppDir, makeTempDir, removeDir } from './helpers/test-environment.js';

const PORT = 47615;

function post(port: number, url: string, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: url,
        method: 'POST',
        headers: { host: `localhost:${port}`, 'x-sb-token': token },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on('error', reject);
    request.end();
  });
}

describe('startServer runs the vault plugins and stops them before the vault (F20)', () => {
  let root: string;
  beforeEach(() => {
    root = makeTempDir('sb plugins Lịch sử');
  });
  afterEach(() => removeDir(root));

  it('starts every plugin, skips one that fails, and POST /api/shutdown closes them while the vault is still open', async () => {
    const { appDir } = makeFakeAppDir(root);
    const events: string[] = [];
    const history: VaultPlugin = {
      name: 'history',
      async start(host) {
        events.push(`start ${host.port}`);
        return {
          async close() {
            // The last auto-commit still reads the vault: it must not be closed yet.
            const listing = await host.context.vault.list();
            events.push(`close with ${listing.files.length > 0 ? 'files' : 'nothing'}`);
          },
        };
      },
    };
    const broken: VaultPlugin = {
      name: 'broken',
      start: async () => {
        throw new TypeError('boom');
      },
    };
    const result = await startServer({
      argv: ['--home', root, '--port', String(PORT)],
      env: {},
      appDir,
      plugins: [broken, history],
    });
    expect(result.kind).toBe('started');
    if (result.kind !== 'started') return;
    expect(events).toEqual([`start ${PORT}`]);
    expect(result.context.plugin('history')).not.toBeNull();
    expect(result.context.plugin('broken')).toBeNull();

    const token = JSON.parse(
      readFileSync(path.join(root, '.secondbrain', 'settings.json'), 'utf8'),
    ).sessionToken;
    expect(await post(PORT, '/api/shutdown', token)).toBe(202);
    await result.shutdownRequested;
    await result.stop();
    expect(events).toEqual([`start ${PORT}`, 'close with files']);
    const log = readFileSync(path.join(result.host.current.vault.paths.logsDir, 'app.log'), 'utf8');
    expect(log).toContain('The broken plugin did not start (TypeError).');
    expect(log).not.toContain('boom');
  });
});
