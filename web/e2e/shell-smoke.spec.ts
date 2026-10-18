/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Smoke test of the UI shell served at the canonical origin: dark theme, sidebar, bundled font,
// security headers and the session token flow.
import { expect, test, type Page } from '@playwright/test';

const SIDEBAR_LABELS_VI = ['Hôm nay', 'Việc cần làm', 'Lịch', 'Bản đồ não'];

function hexToRgb(hex: string): string {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Collects console errors, page errors and CSP violations for the whole test. */
async function watchForProblems(page: Page): Promise<() => Promise<string[]>> {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return async () => {
    const csp = await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    );
    return [...problems, ...csp.map((v) => `csp: ${v}`)];
  };
}

test('dark shell with sidebar, bundled font and strict headers at the canonical origin', async ({
  page,
}) => {
  const collectProblems = await watchForProblems(page);
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['access-control-allow-origin']).toBeUndefined();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const { token, bg, bodyBg } = await page.evaluate(() => ({
    token: document.querySelector('meta[name="sb-token"]')?.getAttribute('content') ?? '',
    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }));
  expect(token).not.toBe('__SB_TOKEN__');
  expect(token.length).toBeGreaterThanOrEqual(20);
  expect(bg.trim().toUpperCase()).toBe('#1C1622');
  expect(bodyBg).toBe(hexToRgb(bg));

  for (const label of SIDEBAR_LABELS_VI) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }

  const fontLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some(
      (f) => f.family.replace(/["']/g, '') === 'Be Vietnam Pro' && f.status === 'loaded',
    );
  });
  expect(fontLoaded).toBe(true);
  expect(await collectProblems()).toEqual([]);
});

test('settings API needs the session token and never returns it', async ({ page }) => {
  await page.goto('/');
  const token = (await page.locator('meta[name="sb-token"]').getAttribute('content')) ?? '';
  const anonymous = await page.request.get('/api/settings');
  expect(anonymous.status()).toBe(401);
  const wrong = await page.request.get('/api/settings', {
    headers: { 'X-SB-Token': 'not-the-token' },
  });
  expect(wrong.status()).toBe(401);
  const ok = await page.request.get('/api/settings', { headers: { 'X-SB-Token': token } });
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body).not.toHaveProperty('sessionToken');
  expect(JSON.stringify(body)).not.toContain(token);
  const health = await page.request.get('/api/health');
  expect(await health.json()).toMatchObject({ ok: true, app: 'second-brain' });
});

test('127.0.0.1 is redirected to the canonical localhost origin', async ({ page }) => {
  const port = new URL(test.info().project.use.baseURL ?? 'http://localhost:4799').port;
  await page.goto(`http://127.0.0.1:${port}/`);
  expect(new URL(page.url()).hostname).toBe('localhost');
});
