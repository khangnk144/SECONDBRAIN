import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { normalizeSettings, type GlobalSettings } from '../../src/config/global-settings.js';
import { buildApp, type BuildAppOptions } from '../../src/http/build-app.js';

/** A temp directory whose name has spaces and Vietnamese characters, like real Windows paths. */
export function makeTempDir(label = 'sb home Đồ án'): string {
  return mkdtempSync(path.join(os.tmpdir(), `${label} `));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export const SHELL_TEMPLATE = `<!doctype html>
<html lang="__SB_LANG__" data-theme="__SB_THEME__" data-palette="__SB_PALETTE__" data-font-size="__SB_FONT_SIZE__">
<head>
<meta charset="utf-8">
<meta name="sb-token" content="__SB_TOKEN__">
<meta name="sb-boot" content="__SB_BOOT__">
<title>Second Brain</title>
<script type="module" src="/assets/app.js"></script>
</head>
<body><div id="root"></div></body>
</html>
`;

/** Creates a fake app/ layout with web/dist containing index.html and one asset. */
export function makeFakeAppDir(root: string): {
  appDir: string;
  webDir: string;
  webDistDir: string;
} {
  const appDir = path.join(root, 'app');
  const webDir = path.join(appDir, 'web');
  const webDistDir = path.join(webDir, 'dist');
  mkdirSync(path.join(webDistDir, 'assets'), { recursive: true });
  writeFileSync(path.join(webDistDir, 'index.html'), SHELL_TEMPLATE);
  writeFileSync(path.join(webDistDir, 'assets', 'app.js'), 'console.log("app");\n');
  return { appDir, webDir, webDistDir };
}

export const TEST_TOKEN = 'test-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export function makeSettings(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
  return { ...normalizeSettings({ sessionToken: TEST_TOKEN }), ...overrides };
}

export interface TestAppHandle {
  app: FastifyInstance;
  settings: GlobalSettings;
  port: number;
  root: string;
  cleanup: () => Promise<void>;
}

/** Builds a production-mode app over a fake web/dist; callers may add stub routes before ready(). */
export async function createTestApp(
  port: number,
  overrides: Partial<BuildAppOptions> & { settings?: GlobalSettings; withDist?: boolean } = {},
): Promise<TestAppHandle> {
  const root = makeTempDir();
  const settings = overrides.settings ?? makeSettings({ port });
  const dirs =
    overrides.withDist === false
      ? { webDir: path.join(root, 'app', 'web'), webDistDir: path.join(root, 'app', 'web', 'dist') }
      : makeFakeAppDir(root);
  const app = await buildApp({
    getSettings: () => settings,
    port,
    mode: 'production',
    webDir: dirs.webDir,
    webDistDir: dirs.webDistDir,
    ...overrides,
  });
  return {
    app,
    settings,
    port,
    root,
    cleanup: async () => {
      await app.close();
      removeDir(root);
    },
  };
}

export function authHeaders(port: number, token = TEST_TOKEN): Record<string, string> {
  return { host: `localhost:${port}`, 'x-sb-token': token };
}
