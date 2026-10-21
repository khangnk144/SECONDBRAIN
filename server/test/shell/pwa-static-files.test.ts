import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerSecurityHooks } from '../../src/security/register-security-hooks.js';
import { registerProdShellSource } from '../../src/shell/prod-shell-source.js';
import { registerUiShellRoutes } from '../../src/shell/register-ui-shell-routes.js';
import {
  distUrlPath,
  listDistPublicPaths,
  staticFileHeaders,
} from '../../src/shell/static-file-headers.js';
import {
  makeSettings,
  makeTempDir,
  removeDir,
  SHELL_TEMPLATE,
  TEST_TOKEN,
} from '../helpers/test-environment.js';

const PORT = 47640;
const host = { host: `localhost:${PORT}` };
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MANIFEST = { id: '/', name: 'Second Brain', start_url: '/', display: 'standalone' };

/** A web/dist like `vite build` writes it, in a folder with spaces and Vietnamese letters. */
function makePwaDist(root: string): string {
  const dist = path.join(root, 'web dist Đồ án');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  mkdirSync(path.join(dist, 'icons'), { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), SHELL_TEMPLATE);
  writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log("app");\n');
  writeFileSync(path.join(dist, 'sw.js'), 'self.addEventListener("fetch", () => {});\n');
  writeFileSync(path.join(dist, 'manifest.webmanifest'), JSON.stringify(MANIFEST));
  writeFileSync(path.join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(path.join(dist, 'icons', 'icon-192.png'), PNG_SIGNATURE);
  writeFileSync(path.join(dist, '.hidden'), 'secret');
  return dist;
}

/** The production composition of the UI side: security hooks first, then the shell. */
async function buildShellApp(dist: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerSecurityHooks(app, { port: PORT, getToken: () => TEST_TOKEN });
  const source = await registerProdShellSource(app, dist);
  const settings = makeSettings({ port: PORT });
  registerUiShellRoutes(app, {
    source,
    getSettings: () => settings,
    port: PORT,
    mode: 'production',
  });
  await app.ready();
  return app;
}

describe('PWA files from web/dist (F21.3)', () => {
  let app: FastifyInstance;
  let root: string;

  beforeAll(async () => {
    root = makeTempDir('sb pwa dist Đồ án');
    app = await buildShellApp(makePwaDist(root));
  });
  afterAll(async () => {
    await app.close();
    removeDir(root);
  });

  const get = (url: string, headers: Record<string, string> = host) =>
    app.inject({ method: 'GET', url, headers });

  it('serves the service worker as JavaScript that is revalidated on every check', async () => {
    const res = await get('/sw.js');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).toContain('addEventListener');
  });

  it('serves the manifest with its own media type, revalidated on every check', async () => {
    const res = await get('/manifest.webmanifest');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/manifest\+json/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.json()).toEqual(MANIFEST);
  });

  it('serves icons from the icons folder as images', async () => {
    const res = await get('/icons/icon-192.png');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.rawPayload.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  });

  it('keeps the shell uncached under the strict CSP (the worker falls back to self)', async () => {
    const res = await get('/', { ...host, accept: 'text/html' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain('unsafe');
    expect(csp).not.toMatch(/worker-src (?!'self')/);
  });

  it('never serves other spellings, directories, dotfiles or the raw template', async () => {
    for (const url of [
      '/SW.JS',
      '/sw.js.',
      '/Manifest.webmanifest',
      '/icons/',
      '/icons',
      '/.hidden',
    ]) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(404);
    }
    for (const url of ['/icons/../index.html', '/icons/%2e%2e/index.html']) {
      const res = await get(url);
      expect(res.body, url).not.toContain('__SB_TOKEN__');
    }
  });

  it('redirects the worker from 127.0.0.1 to the canonical origin like any shell file', async () => {
    const res = await get('/sw.js', { host: `127.0.0.1:${PORT}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`http://localhost:${PORT}/sw.js`);
  });
});

describe('static file header rules', () => {
  it('lists public files outside assets/, without index.html or dotfiles', () => {
    const root = makeTempDir('sb pwa list Đồ án');
    try {
      const dist = makePwaDist(root);
      expect([...listDistPublicPaths(dist)].sort()).toEqual([
        '/favicon.svg',
        '/icons/icon-192.png',
        '/manifest.webmanifest',
        '/sw.js',
      ]);
      expect(distUrlPath(dist, path.join(dist, 'icons', 'icon-192.png'))).toBe(
        '/icons/icon-192.png',
      );
    } finally {
      removeDir(root);
    }
  });

  it('changes only the worker and the manifest', () => {
    expect(staticFileHeaders('/sw.js')['cache-control']).toBe('no-cache');
    expect(staticFileHeaders('/manifest.webmanifest')['content-type']).toMatch(
      /^application\/manifest\+json/,
    );
    expect(staticFileHeaders('/assets/sw.js')).toEqual({});
    expect(staticFileHeaders('/favicon.svg')).toEqual({});
  });
});
