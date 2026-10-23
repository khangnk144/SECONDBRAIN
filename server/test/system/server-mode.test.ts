import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runServerMode, type ServerModeInput } from '../../src/system/server-mode.js';
import type { RuntimeInfo } from '../../src/system/runtime-info.js';
import { makeFakeAppDir, makeTempDir, removeDir } from '../helpers/test-environment.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(removeDir));

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port: number): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const up = await fetch(`http://127.0.0.1:${port}/api/health`).then(
      (response) => response.ok,
      () => false,
    );
    if (up) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server did not start');
}

function setup(port: number) {
  const root = makeTempDir('sb exe start Khởi động');
  roots.push(root);
  const { appDir } = makeFakeAppDir(root);
  const opened: number[] = [];
  const problems: string[] = [];
  const exe: RuntimeInfo = { runtime: 'exe', exePath: path.join(root, 'second-brain') };
  const input = (overrides: Partial<ServerModeInput> = {}): ServerModeInput => ({
    argv: ['--home', root, '--port', String(port)],
    flags: { login: false, stop: false, mcpStdio: false },
    plugins: [],
    runtime: exe,
    platform: 'linux',
    openApp: (opened_port) => opened.push(opened_port),
    problem: (text) => problems.push(text),
    appDir,
    env: {},
    ...overrides,
  });
  return { root, opened, problems, input };
}

describe('exe start mode (F29.1)', () => {
  it('--login starts silently; a second start only opens the app; another folder is refused', async () => {
    const port = await freePort();
    const { root, opened, problems, input } = setup(port);
    const login = { login: true, stop: false, mcpStdio: false };
    const running = runServerMode(input({ flags: login }));
    await waitForHealth(port);
    expect(opened).toEqual([]);

    // Second start of the exe: this home's server answers, so it only opens the app.
    expect(await runServerMode(input())).toBe(0);
    expect(opened).toEqual([port]);
    expect(await runServerMode(input({ flags: login }))).toBe(0);
    expect(opened).toEqual([port]);
    // From source the launcher opens the app itself: nothing is opened here.
    expect(await runServerMode(input({ runtime: { runtime: 'source', exePath: null } }))).toBe(0);
    expect(opened).toEqual([port]);

    // An exe of another folder on the same port: says so, never opens the wrong vault.
    const other = setup(port);
    expect(await runServerMode(other.input())).toBe(2);
    expect(other.opened).toEqual([]);
    expect(other.problems).toEqual([
      `Cổng ${port} đang được một Second Brain khác dùng (của thư mục khác). Thoát bản đó rồi mở lại bản này.`,
    ]);

    const token = (
      JSON.parse(readFileSync(path.join(root, '.secondbrain', 'settings.json'), 'utf8')) as {
        sessionToken: string;
      }
    ).sessionToken;
    const stop = await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
      method: 'POST',
      headers: { 'x-sb-token': token },
    });
    expect(stop.status).toBe(202);
    expect(await running).toBe(0);
    expect(problems).toEqual([]);
  }, 30_000);

  it('opens the app once the started server listens', async () => {
    const port = await freePort();
    const { root, opened, input } = setup(port);
    const running = runServerMode(input());
    await waitForHealth(port);
    await expect.poll(() => opened).toEqual([port]);
    const token = (
      JSON.parse(readFileSync(path.join(root, '.secondbrain', 'settings.json'), 'utf8')) as {
        sessionToken: string;
      }
    ).sessionToken;
    await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
      method: 'POST',
      headers: { 'x-sb-token': token },
    });
    expect(await running).toBe(0);
  }, 30_000);

  it('the executable has no --dev mode (the built UI only)', async () => {
    const { input } = setup(await freePort());
    await expect(runServerMode(input({ argv: ['--dev'] }))).rejects.toThrow('--dev');
  });

  it('a port held by another program is shown in a message (no console in the exe)', async () => {
    // Another program on the port: it drops every connection (no Second Brain health answer).
    const busy = net.createServer((socket) => socket.destroy());
    const port = await new Promise<number>((resolve) =>
      busy.listen(0, '127.0.0.1', () => resolve((busy.address() as net.AddressInfo).port)),
    );
    try {
      const { opened, problems, input } = setup(port);
      expect(await runServerMode(input())).toBe(2);
      expect(opened).toEqual([]);
      expect(problems).toEqual([
        `Cổng ${port} đang bị một chương trình khác dùng. Đóng chương trình đó, hoặc đổi cổng trong Cài đặt của Second Brain rồi mở lại.`,
      ]);
    } finally {
      await new Promise((resolve) => busy.close(resolve));
    }
  }, 30_000);
});
