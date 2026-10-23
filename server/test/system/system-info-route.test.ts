import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpConfig } from '../../src/api/mcp-config-route.js';
import { isApiError, sendApiError } from '../../src/http/api-errors.js';
import {
  provideSystemStatus,
  registerSystemInfoRoutes,
  systemInfo,
} from '../../src/system/system-info-route.js';
import { createVaultTestApp } from '../api/vault-test-app.js';
import { TEST_TOKEN } from '../helpers/test-environment.js';

const EXE_ENV = { SB_RUNTIME: 'exe', SB_EXE_PATH: '/opt/Second Brain/second-brain' };
const running = {
  state: 'running' as const,
  hotkey: 'Ctrl+Alt+Q' as const,
  hotkeyRegistered: false,
};
const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

async function app(options: Parameters<typeof registerSystemInfoRoutes>[1]) {
  const instance = Fastify();
  // The app's error handler shape (build-app.ts) for ApiError refusals.
  instance.setErrorHandler((error, _request, reply) =>
    isApiError(error)
      ? sendApiError(reply, error.status, error.code, error.message, error.details)
      : reply.send(error),
  );
  registerSystemInfoRoutes(instance, options);
  await instance.ready();
  return instance;
}

describe('GET /api/system (F29.2, F29.4)', () => {
  it('(F29.4) says how the app runs; without a running server only the environment', () => {
    expect(systemInfo({ platform: 'linux', env: {} })).toEqual({
      runtime: 'source',
      exePath: null,
      platform: 'other',
      tray: { state: 'unsupported', hotkey: 'Ctrl+Alt+Q', hotkeyRegistered: null },
      shortcuts: { supported: false },
    });
    expect(systemInfo({ platform: 'win32', env: EXE_ENV })).toMatchObject({
      runtime: 'exe',
      exePath: EXE_ENV.SB_EXE_PATH,
      platform: 'windows',
      tray: { state: 'off' },
      shortcuts: { supported: false },
    });
  });

  it('(F29.2, F29.4) reports the tray helper and offers shortcuts for the exe on Windows', async () => {
    const recreate = vi.fn(async () => undefined);
    cleanups.push(provideSystemStatus({ tray: () => running, recreateShortcuts: recreate }));
    const server = await app({ platform: 'win32', env: EXE_ENV });
    const info = (await server.inject({ method: 'GET', url: '/api/system' })).json();
    expect(info.tray).toEqual(running);
    expect(info.shortcuts).toEqual({ supported: true });
    const made = await server.inject({ method: 'POST', url: '/api/system/shortcuts' });
    expect(made.statusCode).toBe(204);
    expect(recreate).toHaveBeenCalledTimes(1);
  });

  it('(F29.4) refuses shortcuts from source, says when Windows refused them', async () => {
    const recreate = vi.fn(async () => {
      throw Object.assign(new Error('blocked'), { code: 'EPERM' });
    });
    cleanups.push(provideSystemStatus({ tray: () => running, recreateShortcuts: recreate }));
    const source = await app({ platform: 'win32', env: {} });
    const refused = await source.inject({ method: 'POST', url: '/api/system/shortcuts' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.details).toEqual({ reason: 'not-exe' });
    expect(recreate).not.toHaveBeenCalled();
    const exe = await app({ platform: 'win32', env: EXE_ENV });
    const failed = await exe.inject({ method: 'POST', url: '/api/system/shortcuts' });
    expect(failed.statusCode).toBe(500);
    expect(failed.json().error.details).toEqual({ reason: 'shortcut-failed', cause: 'EPERM' });
  });

  it('needs the session token like every /api route', async () => {
    const t = await createVaultTestApp(47951);
    try {
      const anonymous = await t.app.inject({
        method: 'GET',
        url: '/api/system',
        headers: { host: 'localhost:47951' },
      });
      expect(anonymous.statusCode).toBe(401);
      expect((await t.call('GET', '/api/system')).statusCode).toBe(200);
      // A state change needs the token and the canonical Origin too.
      const foreign = await t.app.inject({
        method: 'POST',
        url: '/api/system/shortcuts',
        headers: { host: 'localhost:47951', 'x-sb-token': TEST_TOKEN, origin: 'http://evil.test' },
      });
      expect(foreign.statusCode).toBe(403);
    } finally {
      await t.close();
    }
  });
});

describe('Claude Desktop snippet of the executable (F29.4)', () => {
  it('(F29.4) runs the exe with --mcp-stdio; --home only for another home', async () => {
    const base = {
      settings: () => ({ sessionToken: TEST_TOKEN }) as never,
      port: 4747,
      appDir: '/x/app',
    };
    const runtime = { runtime: 'exe' as const, exePath: '/opt/Second Brain/second-brain' };
    const same = await mcpConfig({ ...base, runtime, homeDir: '/opt/Second Brain' });
    expect(same.stdio).toEqual({ command: runtime.exePath, args: ['--mcp-stdio'] });
    expect(same.bridgeBuilt).toBe(true);
    expect(JSON.parse(same.stdioSnippet)).toEqual({ mcpServers: { 'second-brain': same.stdio } });
    const other = await mcpConfig({ ...base, runtime, homeDir: '/data/Đồ án' });
    expect(other.stdio.args).toEqual(['--mcp-stdio', '--home', '/data/Đồ án']);
  });
});
