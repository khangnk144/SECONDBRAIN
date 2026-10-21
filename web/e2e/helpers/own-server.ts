// A Second Brain server of a spec's own, for scenarios the shared e2e server cannot play: kill
// and restart, stop for the offline shell, a vault switch or restore, a second build of the app.
// Each one gets a fresh temporary home (spaces and Vietnamese letters in the path), ports
// 47690–47699 only (never 4747 or the config's 4799), and HOME pointing inside that home, so git
// never reads or writes the machine's own config.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, request as apiRequest, type APIRequestContext } from '@playwright/test';
import { clientFor, shellToken, type AppApi } from './app-api.js';

export interface OwnServer {
  readonly port: number;
  readonly origin: string;
  readonly home: string;
  readonly vaultDir: string;
  /** Starts the server and waits until `/api/health` answers. */
  start(): Promise<void>;
  /** Graceful stop (SIGTERM: the server saves, commits history and exits). */
  stop(): Promise<void>;
  /** Hard kill (SIGKILL): nothing gets a chance to finish. */
  kill(): Promise<void>;
  running(): boolean;
  /** REST client with the token of the served shell (the token survives restarts). */
  api(): Promise<AppApi>;
  /** Last lines the server printed, for failure messages. */
  output(): string;
  /** Stops the server if it runs and removes its home. */
  dispose(): Promise<void>;
}

export interface OwnServerOptions {
  /** App folder to run (`<appDir>/server/dist/index.js`); defaults to this repository. */
  appDir?: string;
  /** Reuse a home (a restart with another build); a fresh one is made otherwise. */
  home?: string;
  /** Extra environment (the AI specs point `SB_AI_*_URL` at the local mock provider). */
  env?: Record<string, string>;
}

export function makeTempHome(label: string): string {
  return mkdtempSync(path.join(tmpdir(), `sb ${label} Đồ án `));
}

async function healthy(origin: string): Promise<boolean> {
  try {
    return (await fetch(`${origin}/api/health`)).ok;
  } catch {
    return false;
  }
}

export function ownServer(port: number, options: OwnServerOptions = {}): OwnServer {
  if (port < 47690 || port > 47699) throw new Error(`port ${port} is outside 47690–47699`);
  const home = options.home ?? makeTempHome(`e2e ${port}`);
  const appDir = options.appDir ?? process.cwd();
  const origin = `http://localhost:${port}`;
  const osHome = path.join(home, 'os-home');
  mkdirSync(osHome, { recursive: true });
  let child: ChildProcess | null = null;
  let exited: Promise<void> = Promise.resolve();
  let request: APIRequestContext | null = null;
  let log = '';

  const waitExit = async (signal: NodeJS.Signals) => {
    const current = child;
    if (!current) return;
    current.kill(signal);
    const timeout = new Promise<'timeout'>((done) => setTimeout(() => done('timeout'), 20_000));
    if ((await Promise.race([exited, timeout])) === 'timeout') {
      current.kill('SIGKILL');
      await exited;
    }
  };

  const server: OwnServer = {
    port,
    origin,
    home,
    vaultDir: path.join(home, 'vault'),
    async start() {
      if (child) throw new Error('server already started');
      expect(await healthy(origin), `port ${port} is already answering`).toBe(false);
      const started = spawn(
        'node',
        [path.join(appDir, 'server', 'dist', 'index.js'), '--port', String(port), '--home', home],
        {
          cwd: appDir,
          env: {
            ...process.env,
            HOME: osHome,
            USERPROFILE: osHome,
            XDG_CONFIG_HOME: path.join(osHome, '.config'),
            ...options.env,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      child = started;
      const keep = (chunk: Buffer) => {
        log = (log + chunk.toString('utf8')).slice(-8_000);
      };
      started.stdout?.on('data', keep);
      started.stderr?.on('data', keep);
      exited = new Promise((done) =>
        started.once('exit', () => {
          if (child === started) child = null;
          done();
        }),
      );
      await expect
        .poll(
          async () => {
            if (child !== started) throw new Error(`server exited while starting:\n${log}`);
            return healthy(origin);
          },
          { timeout: 60_000, intervals: [100, 250, 500] },
        )
        .toBe(true);
    },
    stop: () => waitExit('SIGTERM'),
    kill: () => waitExit('SIGKILL'),
    running: () => child !== null,
    async api() {
      request ??= await apiRequest.newContext({ baseURL: origin });
      return clientFor(request, await shellToken(request), origin);
    },
    output: () => log,
    async dispose() {
      await server.stop();
      await request?.dispose();
      request = null;
      if (!options.home && existsSync(home)) rmSync(home, { recursive: true, force: true });
    },
  };
  return server;
}

/**
 * Browser launch options of a desktop session (`test.use(UTF8_BROWSER)`): under this machine's
 * POSIX locale Chromium can neither pick a file nor name a download whose path has Vietnamese
 * letters (the file input stays empty, the download is called "download").
 */
export const UTF8_BROWSER = {
  launchOptions: { env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } },
};
