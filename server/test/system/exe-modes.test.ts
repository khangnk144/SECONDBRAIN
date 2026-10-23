import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CliUsageError } from '../../src/config/cli-args.js';
import { splitExeFlags } from '../../src/system/exe-cli.js';
import { findOwnServer, readHomeVaultId } from '../../src/system/own-server.js';
import { runtimeInfo } from '../../src/system/runtime-info.js';
import { runStopMode } from '../../src/system/stop-mode.js';
import { APP_ID } from '../../src/version.js';
import { makeTempDir, removeDir, TEST_TOKEN } from '../helpers/test-environment.js';

const PORT = 47941;
const OTHER_PORT = 47942;
const DEAD_PID = 2_000_000_000;
const homes: string[] = [];
afterEach(() => homes.splice(0).forEach(removeDir));

function home(options: { vaultId?: string; serverJson?: { pid: number; port: number } } = {}) {
  const dir = makeTempDir('sb exe home Đồ án');
  homes.push(dir);
  mkdirSync(path.join(dir, '.secondbrain'), { recursive: true });
  writeFileSync(
    path.join(dir, '.secondbrain', 'settings.json'),
    JSON.stringify({ port: PORT, sessionToken: TEST_TOKEN }),
  );
  if (options.vaultId) {
    mkdirSync(path.join(dir, 'vault', '.secondbrain'), { recursive: true });
    writeFileSync(
      path.join(dir, 'vault', '.secondbrain', 'vault.json'),
      JSON.stringify({ id: options.vaultId }),
    );
  }
  if (options.serverJson) {
    writeFileSync(
      path.join(dir, '.secondbrain', 'server.json'),
      JSON.stringify(options.serverJson),
    );
  }
  return dir;
}

/** A fake server: health per port (vault id), records requests, can go down after shutdown. */
function fakeServer(health: Map<number, string | null>, options: { stops?: boolean } = {}) {
  const requests: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const port = Number(url.port);
    requests.push({
      url: url.pathname,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    if (!health.has(port)) throw new TypeError('fetch failed');
    if (url.pathname === '/api/shutdown') {
      if (options.stops !== false) health.delete(port);
      return new Response('{"ok":true}', { status: 202 });
    }
    return new Response(JSON.stringify({ ok: true, app: APP_ID, vaultId: health.get(port) }), {
      status: 200,
    });
  };
  return { fetch: fetchImpl, requests };
}

describe('exe flags and runtime (F29.1)', () => {
  it('takes --login, --stop and --mcp-stdio out of argv and refuses two at once', () => {
    expect(splitExeFlags(['--home', 'D:\\Đồ án', '--login'])).toEqual({
      flags: { login: true, stop: false, mcpStdio: false },
      rest: ['--home', 'D:\\Đồ án'],
    });
    expect(splitExeFlags(['--mcp-stdio']).flags.mcpStdio).toBe(true);
    expect(() => splitExeFlags(['--stop', '--login'])).toThrow(CliUsageError);
  });

  it('is exe only when the bootstrap set SB_RUNTIME=exe with an absolute SB_EXE_PATH', () => {
    const exePath = 'C:\\Users\\Khang\\Second Brain\\Second Brain.exe';
    expect(runtimeInfo({ SB_RUNTIME: 'exe', SB_EXE_PATH: exePath })).toEqual({
      runtime: 'exe',
      exePath,
    });
    expect(runtimeInfo({ SB_RUNTIME: 'exe', SB_EXE_PATH: 'relative.exe' }).runtime).toBe('source');
    expect(runtimeInfo({ SB_EXE_PATH: exePath })).toEqual({ runtime: 'source', exePath: null });
  });
});

describe('single instance of the executable (F29.1)', () => {
  it('a live server.json of this home is ours', async () => {
    const dir = home({ serverJson: { pid: process.pid, port: OTHER_PORT } });
    const { fetch } = fakeServer(new Map([[OTHER_PORT, 'any']]));
    expect(await findOwnServer({ home: dir, fetch })).toEqual({ kind: 'ours', port: OTHER_PORT });
  });

  it('else the configured port must answer with this home vault id', async () => {
    const dir = home({ vaultId: 'vault-a', serverJson: { pid: DEAD_PID, port: OTHER_PORT } });
    expect(await readHomeVaultId(dir)).toBe('vault-a');
    const same = fakeServer(new Map([[PORT, 'vault-a']]));
    expect(await findOwnServer({ home: dir, fetch: same.fetch })).toEqual({
      kind: 'ours',
      port: PORT,
    });
    const other = fakeServer(new Map([[PORT, 'vault-b']]));
    expect(await findOwnServer({ home: dir, fetch: other.fetch })).toEqual({
      kind: 'other',
      port: PORT,
    });
    const none = fakeServer(new Map());
    expect(await findOwnServer({ home: dir, fetch: none.fetch })).toEqual({ kind: 'none' });
    // --port wins over settings.json.
    const moved = fakeServer(new Map([[OTHER_PORT, 'vault-a']]));
    expect(
      await findOwnServer({ home: dir, fetch: moved.fetch, portOverride: OTHER_PORT }),
    ).toEqual({ kind: 'ours', port: OTHER_PORT });
  });

  it('a home without a vault yet never claims a running server', async () => {
    const dir = home();
    const { fetch } = fakeServer(new Map([[PORT, 'vault-x']]));
    expect(await findOwnServer({ home: dir, fetch })).toEqual({ kind: 'other', port: PORT });
  });
});

describe('--stop (F29.1)', () => {
  const quiet = () => undefined;

  it('asks the server to shut down with the token (no Origin) and waits until it is gone', async () => {
    const dir = home({ vaultId: 'vault-a' });
    const server = fakeServer(new Map([[PORT, 'vault-a']]));
    expect(await runStopMode({ home: dir, fetch: server.fetch, print: quiet, pollMs: 5 })).toBe(0);
    const shutdown = server.requests.find((request) => request.url === '/api/shutdown');
    expect(shutdown?.method).toBe('POST');
    expect(shutdown?.headers['x-sb-token']).toBe(TEST_TOKEN);
    expect(shutdown?.headers.origin).toBeUndefined();
  });

  it('exits 0 when nothing runs, 1 for another folder or a server that stays up', async () => {
    const dir = home({ vaultId: 'vault-a' });
    expect(await runStopMode({ home: dir, fetch: fakeServer(new Map()).fetch, print: quiet })).toBe(
      0,
    );
    const foreign = fakeServer(new Map([[PORT, 'vault-b']]));
    expect(await runStopMode({ home: dir, fetch: foreign.fetch, print: quiet })).toBe(1);
    expect(foreign.requests.some((request) => request.url === '/api/shutdown')).toBe(false);
    const stubborn = fakeServer(new Map([[PORT, 'vault-a']]), { stops: false });
    expect(
      await runStopMode({
        home: dir,
        fetch: stubborn.fetch,
        print: quiet,
        timeoutMs: 50,
        pollMs: 5,
      }),
    ).toBe(1);
  });
});
