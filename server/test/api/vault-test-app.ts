import { mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import {
  createAppContext,
  type AppContext,
  type AppContextOptions,
} from '../../src/app-context/create-app-context.js';
import type { VaultRouteOptions } from '../../src/api/register-vault-routes.js';
import type { GlobalSettings } from '../../src/config/global-settings.js';
import { buildApp } from '../../src/http/build-app.js';
import { createSilentLogger, type AppLogger } from '../../src/logging/rotating-file-logger.js';
import { authHeaders, makeSettings, makeTempDir, removeDir } from '../helpers/test-environment.js';

export interface VaultTestApp {
  home: string;
  vaultRoot: string;
  port: number;
  /** The live settings object the app reads (tests may change `ui.language`). */
  settings: GlobalSettings;
  context: AppContext;
  app: FastifyInstance;
  /** Authenticated request with the canonical Origin (what the UI sends). */
  call(
    method: InjectOptions['method'],
    url: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse>;
  /** Closes the app and the vault; removes the temp home unless the caller passed one. */
  close(): Promise<void>;
}

/**
 * A real app context (vault, index, watcher) on a temp home whose name has spaces and
 * Vietnamese letters, plus an API-only Fastify app. `listen: true` binds 127.0.0.1:<port>
 * for WebSocket clients.
 */
export async function createVaultTestApp(
  port: number,
  options: Pick<AppContextOptions, 'now' | 'watcher' | 'faults'> & {
    listen?: boolean;
    /** Writes files into `<home>/vault` before the vault opens (as if they were already there). */
    seed?: (vaultRoot: string) => void;
    /** Reopens an existing install (a restart); the caller then removes it. */
    home?: string;
    logger?: AppLogger;
    vaultRoutes?: VaultRouteOptions;
  } = {},
): Promise<VaultTestApp> {
  const home = options.home ?? makeTempDir('sb vault home Ghi chú');
  if (options.seed) {
    mkdirSync(path.join(home, 'vault'));
    options.seed(path.join(home, 'vault'));
  }
  const settings = makeSettings({ port });
  const context = await createAppContext({
    home,
    settings,
    logger: options.logger ?? createSilentLogger(),
    now: options.now,
    watcher: options.watcher ?? { stabilityMs: 100 },
    faults: options.faults,
  });
  const app = await buildApp({
    getSettings: () => settings,
    port,
    mode: 'production',
    webDir: path.join(home, 'app', 'web'),
    webDistDir: path.join(home, 'app', 'web', 'dist'),
    serveUi: false,
    context,
    logger: options.logger,
    vaultRoutes: options.vaultRoutes,
  });
  if (options.listen) await app.listen({ host: '127.0.0.1', port });
  else await app.ready();
  return {
    home,
    vaultRoot: context.vault.root,
    port,
    settings,
    context,
    app,
    call: (method, url, payload) =>
      app.inject({
        method,
        url,
        headers: { ...authHeaders(port), origin: `http://localhost:${port}` },
        ...(payload === undefined ? {} : { payload: payload as InjectOptions['payload'] }),
      }),
    async close() {
      await app.close();
      await context.close();
      if (!options.home) removeDir(home);
    },
  };
}

/** `?path=` with proper encoding (spaces, Vietnamese letters). */
export const q = (vaultPath: string) => `path=${encodeURIComponent(vaultPath)}`;

/** Every entry under `dir` with size and mtime, for "nothing changed" snapshots. */
export function snapshotTree(dir: string, skip: (relative: string) => boolean = () => false) {
  const out: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      const relative = path.relative(dir, abs).split(path.sep).join('/');
      if (skip(relative)) continue;
      const stats = statSync(abs);
      out[relative] = entry.isDirectory() ? 'dir' : `${stats.size}:${stats.mtimeMs}`;
      if (entry.isDirectory()) walk(abs);
    }
  };
  walk(dir);
  return out;
}

export async function waitUntil<T>(
  probe: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 1000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Logger that keeps every line in memory, for "what reaches the log" assertions. */
export function createMemoryLogger(): AppLogger & { lines: string[] } {
  const lines: string[] = [];
  return {
    file: null,
    lines,
    info: (message) => lines.push(`INFO ${message}`),
    warn: (message) => lines.push(`WARN ${message}`),
    error: (message) => lines.push(`ERROR ${message}`),
  };
}
