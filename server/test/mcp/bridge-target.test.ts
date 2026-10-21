import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureServer,
  findRunningServer,
  processAlive,
  readLiveServerPort,
} from '../../src/mcp/bridge-server.js';
import { APP_ID } from '../../src/version.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';

// Nothing listens: health answers come from an injected fetch keyed by port.
const SETTINGS_PORT = 47616;
const LIVE_PORT = 47615;
const TOKEN = 'bridge-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const DEAD_PID = 2_000_000_000;

function fakeHealth(up: Set<number>, asked: number[] = []): typeof fetch {
  return async (input) => {
    const port = Number(new URL(String(input)).port);
    asked.push(port);
    if (!up.has(port)) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ ok: true, app: APP_ID }), { status: 200 });
  };
}

const homes: string[] = [];
function home(serverJson?: { pid: number; port: number }): string {
  const dir = makeTempDir('sb bridge port Cổng');
  homes.push(dir);
  mkdirSync(path.join(dir, '.secondbrain'), { recursive: true });
  writeFileSync(
    path.join(dir, '.secondbrain', 'settings.json'),
    JSON.stringify({ port: SETTINGS_PORT, sessionToken: TOKEN }),
  );
  if (serverJson) writeServerJson(dir, serverJson);
  return dir;
}
function writeServerJson(dir: string, info: { pid: number; port: number }) {
  writeFileSync(
    path.join(dir, '.secondbrain', 'server.json'),
    JSON.stringify({ ...info, startedAt: '2026-10-21T08:00:00.000Z', version: '0.6.0' }),
  );
}

afterEach(() => {
  for (const dir of homes.splice(0)) removeDir(dir);
});

describe('stdio bridge finds the live server port (F32.1)', () => {
  it('prefers the port of a live server in server.json (started with --port)', async () => {
    const dir = home({ pid: process.pid, port: LIVE_PORT });
    expect(await readLiveServerPort(dir)).toBe(LIVE_PORT);
    let starts = 0;
    const target = await ensureServer({
      home: dir,
      fetch: fakeHealth(new Set([LIVE_PORT, SETTINGS_PORT])),
      startServer: () => void (starts += 1),
      timeoutMs: 200,
      pollMs: 10,
      report: () => undefined,
    });
    expect(target).toEqual({ port: LIVE_PORT, token: TOKEN });
    expect(starts).toBe(0);
  });

  it('falls back to the settings port when server.json is stale, odd or silent', async () => {
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(DEAD_PID)).toBe(false);
    const stale = home({ pid: DEAD_PID, port: LIVE_PORT });
    expect(await readLiveServerPort(stale)).toBeNull();
    const asked: number[] = [];
    const up = fakeHealth(new Set([LIVE_PORT, SETTINGS_PORT]), asked);
    expect(await findRunningServer(stale, up)).toEqual({ port: SETTINGS_PORT, token: TOKEN });
    expect(asked).toEqual([SETTINGS_PORT]);

    const silent = home({ pid: process.pid, port: LIVE_PORT });
    const onlySettings = fakeHealth(new Set([SETTINGS_PORT]));
    expect(await findRunningServer(silent, onlySettings)).toEqual({
      port: SETTINGS_PORT,
      token: TOKEN,
    });

    const odd = home();
    writeFileSync(path.join(odd, '.secondbrain', 'server.json'), '{"pid":"x","port":70000}');
    expect(await readLiveServerPort(odd)).toBeNull();
    expect(await findRunningServer(odd, fakeHealth(new Set()))).toBeNull();
  });

  it('after starting the server it connects to the port the new server.json names', async () => {
    const dir = home();
    const up = new Set<number>();
    const reports: string[] = [];
    const target = await ensureServer({
      home: dir,
      fetch: fakeHealth(up),
      startServer: () => {
        writeServerJson(dir, { pid: process.pid, port: LIVE_PORT });
        up.add(LIVE_PORT);
      },
      timeoutMs: 2000,
      pollMs: 10,
      report: (code) => reports.push(code),
    });
    expect(target).toEqual({ port: LIVE_PORT, token: TOKEN });
    expect(reports).toEqual(['SERVER_STARTING', 'SERVER_READY']);
  });
});
