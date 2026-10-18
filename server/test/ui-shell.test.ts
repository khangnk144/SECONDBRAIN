import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { escapeHtmlAttribute, renderUiShell } from '../src/shell/render-ui-shell.js';
import { buildContentSecurityPolicy } from '../src/security/security-headers.js';
import {
  createTestApp,
  makeSettings,
  SHELL_TEMPLATE,
  TEST_TOKEN,
  type TestAppHandle,
} from './helpers/test-environment.js';

const PORT = 4785;
const html = { host: `localhost:${PORT}`, accept: 'text/html' };

describe('UI shell rendering', () => {
  it('replaces every placeholder and escapes values for attributes', () => {
    const settings = makeSettings();
    settings.ui.name = 'Khang "<script>alert(1)</script>" & co\'s';
    const out = renderUiShell(SHELL_TEMPLATE, { token: TEST_TOKEN, ui: settings.ui });
    expect(out).not.toMatch(/__SB_[A-Z_]+__/);
    expect(out).toContain(`<meta name="sb-token" content="${TEST_TOKEN}">`);
    expect(out).toContain('lang="vi" data-theme="dark" data-palette="dau-tam" data-font-size="16"');
    expect(out).not.toContain('<script>alert');
    const boot = /name="sb-boot" content="([^"]*)"/.exec(out)?.[1] ?? '';
    const decoded = boot
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    expect(JSON.parse(decoded)).toEqual({ ...settings.ui });
  });

  it('escapes all attribute-breaking characters', () => {
    expect(escapeHtmlAttribute(`a&b"c'd<e>f`)).toBe('a&amp;b&quot;c&#39;d&lt;e&gt;f');
  });

  it('production CSP has no inline script or style; development only relaxes what Vite needs', () => {
    const prod = buildContentSecurityPolicy({ port: PORT, mode: 'production' });
    expect(prod).toContain("default-src 'self'");
    expect(prod).toContain("script-src 'self';");
    expect(prod).toContain("style-src 'self';");
    expect(prod).not.toContain('unsafe');
    expect(prod).toContain(`connect-src 'self' ws://localhost:${PORT}`);
    expect(prod).toContain("frame-ancestors 'none'");
    const dev = buildContentSecurityPolicy({ port: PORT, mode: 'development', hmrPort: 24678 });
    expect(dev).toContain("script-src 'self' 'unsafe-inline'");
    expect(dev).toContain('ws://localhost:24678');
  });
});

describe('UI shell routes (production)', () => {
  let handle: TestAppHandle;
  beforeAll(async () => {
    handle = await createTestApp(PORT);
    await handle.app.ready();
  });
  afterAll(async () => handle.cleanup());

  it('serves the shell at "/" with the token, CSP and security headers, never cached', async () => {
    const res = await handle.app.inject({ method: 'GET', url: '/', headers: html });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain(`content="${TEST_TOKEN}"`);
    expect(res.headers['content-security-policy']).toBe(
      buildContentSecurityPolicy({ port: PORT, mode: 'production' }),
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('serves built assets and never the raw index.html template', async () => {
    const asset = await handle.app.inject({
      method: 'GET',
      url: '/assets/app.js',
      headers: { host: html.host },
    });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['x-content-type-options']).toBe('nosniff');
    const raw = await handle.app.inject({
      method: 'GET',
      url: '/index.html',
      headers: { host: html.host },
    });
    expect(raw.body).not.toContain('__SB_TOKEN__');
  });

  it('serves only /assets/ and top-level public files, so other spellings of index.html never leak', async () => {
    // On NTFS these spellings can reach the same file as /index.html.
    for (const url of ['/INDEX.HTML', '/index.html.', '/index.html::$DATA', '/Index.Html']) {
      const res = await handle.app.inject({ method: 'GET', url, headers: { host: html.host } });
      expect(res.body, url).not.toContain('__SB_TOKEN__');
    }
  });

  it('falls back to the shell for HTML navigations and to JSON 404 otherwise', async () => {
    const nav = await handle.app.inject({ method: 'GET', url: '/some/deep/link', headers: html });
    expect(nav.statusCode).toBe(200);
    expect(nav.body).toContain('id="root"');
    const missing = await handle.app.inject({
      method: 'GET',
      url: '/assets/missing.js',
      headers: { host: html.host },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');
  });
});

describe('UI shell when the UI is not built', () => {
  it('answers 503 with a hint to run npm run build', async () => {
    const handle = await createTestApp(PORT, { withDist: false });
    await handle.app.ready();
    const res = await handle.app.inject({ method: 'GET', url: '/', headers: html });
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('npm run build');
    await handle.cleanup();
  });
});
