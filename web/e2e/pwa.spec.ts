/// <reference lib="dom" />
// PWA install checklist, the parts Chromium can drive (SPEC F21.3): a valid manifest (name, icons
// 192/512, standalone, start URL, theme colour), the service worker registered and controlling
// the page after a reload; with the server stopped a reload still shows the app shell from the
// worker with the backend banner (no browser error page); when the server comes up the window
// recovers in place – folders, Today's tasks and a note load without a reload; a new build (another BUILD_ID in sw.js) is offered with "Có bản mới của app." and
// "Tải lại" switches to it. The install prompt and the installed window are checked by hand on
// Windows.
import { rmSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { localIso } from './helpers/app-api.js';
import { appCopyWithBuildId, currentBuildId } from './helpers/app-copy.js';
import { appReady } from './helpers/keyboard.js';
import { noteBody, noteHash } from './helpers/note-page.js';
import { makeTempHome, ownServer, type OwnServer } from './helpers/own-server.js';
import { shot } from './helpers/screenshots.js';

const PORT = 47696;
let servers: OwnServer[] = [];
const dirs: string[] = [];
test.afterEach(async () => {
  for (const server of servers.reverse()) await server.dispose();
  servers = [];
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const offlineBanner = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Chưa kết nối với máy chủ.' });

const cacheNames = (page: Page) => page.evaluate(() => caches.keys());

test('manifest, service worker, offline shell with banner, reconnect, shell update (F21.3)', async ({
  page,
}) => {
  test.slow();
  const home = makeTempHome('pwa');
  dirs.push(home);
  const first = ownServer(PORT, { home });
  servers.push(first);
  await first.start();
  const origin = first.origin;
  // Something to find once the window recovers: a note with a task due today.
  const notePath = '1 Projects/Ghi chú khi mất kết nối.md';
  await (
    await first.api()
  ).send('POST', '/api/note', {
    path: notePath,
    content: `# Ghi chú khi mất kết nối\n\n- [ ] Việc của hôm nay 📅 ${localIso()}\n`,
  });

  // Manifest: linked, valid JSON with the fields an install needs; its icons are real PNGs.
  await page.goto(`${origin}/`);
  await appReady(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');
  const manifestResponse = await page.request.get(`${origin}${href}`);
  expect(manifestResponse.headers()['content-type']).toMatch(/^application\/manifest\+json/);
  const manifest = (await manifestResponse.json()) as {
    name: string;
    start_url: string;
    display: string;
    theme_color: string;
    icons: { src: string; sizes: string; type: string }[];
  };
  expect(manifest).toMatchObject({
    name: 'Second Brain',
    start_url: '/',
    display: 'standalone',
    theme_color: '#1C1622',
  });
  for (const size of ['192x192', '512x512']) {
    const icon = manifest.icons.find((i) => i.sizes === size && i.type === 'image/png');
    expect(icon, `icon ${size}`).toBeTruthy();
    const png = await page.request.get(`${origin}${icon!.src}`);
    expect(png.status()).toBe(200);
    expect((await png.body()).subarray(1, 4).toString('ascii')).toBe('PNG');
  }
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#1C1622');

  // The worker registers, activates and controls the page after a reload.
  const buildId = currentBuildId();
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
    .toBe('activated');
  await page.reload();
  await appReady(page);
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(
    `${origin}/sw.js`,
  );
  expect(await cacheNames(page)).toContain(`sb-shell-${buildId}`);

  // Server stopped: the reload is answered by the worker, the app shows the backend banner.
  await first.stop();
  const offline = await page.reload();
  expect(offline?.fromServiceWorker()).toBe(true);
  await expect(page).toHaveTitle('Second Brain');
  await expect(offlineBanner(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  await shot(page, 'pwa-offline-banner');

  // Started without the server: the folder list and Today's tasks say they could not load.
  await expect(page.getByText('Chưa tải được danh sách thư mục.')).toBeVisible();
  await page.evaluate(
    () => ((window as unknown as { __offlineBoot: boolean }).__offlineBoot = true),
  );

  // Server back: this same window recovers in place – banner gone, folders, Today's task and a
  // note load, no reload (the marker set in the offline-booted document is still there).
  await first.start();
  await expect(offlineBanner(page)).toHaveCount(0, { timeout: 30_000 });
  await appReady(page);
  const tasks = page.getByRole('region', { name: 'Hôm nay', exact: true });
  await expect(tasks.getByRole('checkbox', { name: 'Việc của hôm nay' })).toBeVisible({
    timeout: 15_000,
  });
  await page.evaluate((hash) => (window.location.hash = hash), noteHash(notePath));
  await expect(noteBody(page)).toContainText('Việc của hôm nay');
  expect(
    await page.evaluate(
      () => (window as unknown as { __offlineBoot?: boolean }).__offlineBoot === true,
    ),
  ).toBe(true);

  // A new build on the same port and home: the reconnect looks for it, the toast offers it,
  // "Tải lại" activates the new worker (one reload) and drops the old cache.
  const newId = buildId === '0123456789abcdef' ? 'fedcba9876543210' : '0123456789abcdef';
  const copyDir = makeTempHome('pwa build');
  dirs.push(copyDir);
  const second = ownServer(PORT, { home, appDir: appCopyWithBuildId(copyDir, newId) });
  servers.push(second);
  await first.stop();
  await second.start();
  const toast = page.getByRole('region', { name: 'Thông báo' }).filter({
    hasText: 'Có bản mới của app.',
  });
  await expect(toast).toBeVisible({ timeout: 30_000 });
  await shot(page, 'pwa-update-toast');
  const reloaded = page.waitForEvent('load');
  await toast.getByRole('button', { name: 'Tải lại' }).click();
  await reloaded;
  await appReady(page);
  await expect.poll(() => cacheNames(page)).toContain(`sb-shell-${newId}`);
  await expect.poll(() => cacheNames(page)).not.toContain(`sb-shell-${buildId}`);
  expect(
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return {
        waiting: registration?.waiting ?? null,
        controlled: !!navigator.serviceWorker.controller,
      };
    }),
  ).toEqual({ waiting: null, controlled: true });
});
