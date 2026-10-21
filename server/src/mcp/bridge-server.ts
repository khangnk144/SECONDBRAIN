/**
 * The stdio bridge's view of the server: where it listens, its token, whether it is up, and how
 * to start it. Reads `<home>/.secondbrain/settings.json` (token, configured port) and
 * `server.json` (the port a live server really listens on, e.g. one started with `--port`) and
 * never writes either. Imports nothing of the vault, index or background jobs (the bridge runs no
 * jobs of its own, SPEC F32).
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { APP_ID } from '../version.js';

export const DEFAULT_BRIDGE_PORT = 4747;

export interface BridgeTarget {
  port: number;
  token: string | null;
}

const isPort = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0 && (value as number) < 65536;

/** Port and session token from the global settings; defaults when the file is missing or odd. */
export async function readBridgeTarget(home: string): Promise<BridgeTarget> {
  try {
    const text = await readFile(path.join(home, '.secondbrain', 'settings.json'), 'utf8');
    const settings = JSON.parse(text) as { port?: unknown; sessionToken?: unknown };
    const port = isPort(settings.port) ? settings.port : DEFAULT_BRIDGE_PORT;
    const token = typeof settings.sessionToken === 'string' ? settings.sessionToken : null;
    return { port, token };
  } catch {
    return { port: DEFAULT_BRIDGE_PORT, token: null };
  }
}

/** Whether a process with this id exists (EPERM: it exists, owned by someone else). */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * The port in `<home>/.secondbrain/server.json` (written by the server once it listens, removed
 * when it stops), or null when the file is missing, odd, or names a process that is gone (a
 * crashed server leaves the file behind).
 */
export async function readLiveServerPort(
  home: string,
  alive: (pid: number) => boolean = processAlive,
): Promise<number | null> {
  try {
    const text = await readFile(path.join(home, '.secondbrain', 'server.json'), 'utf8');
    const info = JSON.parse(text) as { pid?: unknown; port?: unknown };
    if (!isPort(info.port) || !Number.isInteger(info.pid) || (info.pid as number) <= 0) return null;
    return alive(info.pid as number) ? info.port : null;
  } catch {
    return null;
  }
}

/**
 * The server to connect to: the live server of `server.json` when it answers `/api/health`, else
 * the port in `settings.json` when that answers (a server started with `--port N` still stores
 * the configured port in settings); null when neither answers. The token is always the settings'.
 */
export async function findRunningServer(
  home: string,
  fetchImpl: typeof fetch,
  alive?: (pid: number) => boolean,
): Promise<BridgeTarget | null> {
  const configured = await readBridgeTarget(home);
  const live = await readLiveServerPort(home, alive);
  const ports =
    live === null || live === configured.port ? [configured.port] : [live, configured.port];
  for (const port of ports) {
    if (await isServerUp(port, fetchImpl)) return { port, token: configured.token };
  }
  return null;
}

/** `GET http://127.0.0.1:<port>/api/health` answers as a Second Brain server. */
export async function isServerUp(port: number, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { app?: unknown };
    return body.app === APP_ID;
  } catch {
    return false;
  }
}

/**
 * Starts the server in the background, detached from the bridge. Windows: the hidden launcher
 * (installs and builds when needed, then starts the server without a window); elsewhere: the
 * built server with this home.
 */
export function defaultStartServer(
  home: string,
  appDir: string,
  platform: NodeJS.Platform = process.platform,
): () => void {
  return () => {
    const child =
      platform === 'win32'
        ? spawn('wscript.exe', [path.join(appDir, 'launcher', 'start-hidden.vbs')], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          })
        : spawn(
            process.execPath,
            [path.join(appDir, 'server', 'dist', 'index.js'), '--home', home],
            {
              cwd: appDir,
              detached: true,
              stdio: 'ignore',
            },
          );
    // A missing program is reported by the health wait that follows, not by a crash here.
    child.on('error', () => undefined);
    child.unref();
  };
}

export interface EnsureServerOptions {
  home: string;
  fetch: typeof fetch;
  startServer: () => void | Promise<void>;
  timeoutMs: number;
  pollMs: number;
  /** Diagnostic codes (stderr). */
  report: (code: string) => void;
  /** Process check for `server.json` (tests); default `processAlive`. */
  alive?: (pid: number) => boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The running server's target; starts it once and waits for health when it is down. */
export async function ensureServer(options: EnsureServerOptions): Promise<BridgeTarget> {
  const find = () => findRunningServer(options.home, options.fetch, options.alive);
  const running = await find();
  if (running) return running;
  options.report('SERVER_STARTING');
  await options.startServer();
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    await sleep(options.pollMs);
    // The first start creates settings.json (port and token) and server.json: read both again.
    const target = await find();
    if (target) {
      options.report('SERVER_READY');
      return target;
    }
  }
  options.report('SERVER_UNREACHABLE');
  throw new Error('SERVER_UNREACHABLE');
}
