/// <reference lib="dom" />
// Settings in a real browser (SPEC F18): name, language, theme, palette and font size apply at
// once without a reload and are still there after one (F18.1); an API key is shown only as
// "…last4" and its full text is in no response the page receives (F18.2); "Xây lại chỉ mục"
// shows its progress and a note edited meanwhile is found afterwards (F18.4). Own server per
// test: settings are global to a home.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { appReady } from './helpers/keyboard.js';
import { makeTempHome, ownServer, type OwnServer } from './helpers/own-server.js';
import { shot } from './helpers/screenshots.js';

let server: OwnServer | null = null;
test.afterEach(async () => {
  await server?.dispose();
  server = null;
});

async function startServer(home?: string): Promise<OwnServer> {
  server = ownServer(47692, { home });
  await server.start();
  return server;
}

/** What the screen shows of the UI prefs, read from <html> and the computed styles. */
const shownPrefs = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    return {
      theme: root.dataset['theme'],
      palette: root.dataset['palette'],
      fontSize: style.fontSize,
      lang: root.lang,
      accent: style.getPropertyValue('--accent').trim(),
      background: getComputedStyle(document.body).backgroundColor,
    };
  });

/** A marker that only survives as long as the page is not reloaded. */
const markDocument = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __sameDocument: boolean }).__sameDocument = true));
const sameDocument = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true);

test('appearance, name and language apply without reload and persist (F18.1)', async ({ page }) => {
  const own = await startServer();
  await page.goto(`${own.origin}/#/settings`);
  await expect(page.getByRole('heading', { level: 1, name: 'Cài đặt' })).toBeVisible();
  await appReady(page);
  const before = await shownPrefs(page);
  expect(before).toMatchObject({ theme: 'dark', palette: 'dau-tam', fontSize: '16px', lang: 'vi' });
  await markDocument(page);

  const name = page.getByLabel('Tên để chào');
  await name.fill('Lan Anh');
  await name.press('Enter');
  await expect(page.locator('#settings-name-status')).toHaveText('Đã lưu');
  await page.getByRole('radio', { name: 'Sáng' }).check();
  await expect.poll(async () => (await shownPrefs(page)).theme).toBe('light');
  await page.getByRole('radio', { name: 'Hoa đào' }).check();
  await page.getByRole('radio', { name: '18 px' }).check();
  // Applied on the next render, not inside the click.
  await expect
    .poll(() => shownPrefs(page))
    .toMatchObject({ theme: 'light', palette: 'hoa-dao', fontSize: '18px' });
  const changed = await shownPrefs(page);
  expect(changed.accent).not.toBe(before.accent);
  expect(changed.background).not.toBe(before.background);
  await page.getByRole('radio', { name: 'English' }).check();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect.poll(async () => (await shownPrefs(page)).lang).toBe('en');
  await shot(page, 'settings-light-en');

  // Today greets her by the new name, in English, still in the same document.
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', {
      name: 'Today',
    })
    .click();
  const greeting = page.getByRole('heading', { level: 1 });
  await expect(greeting).toHaveText(
    /^(Good (morning|midday|afternoon|evening)|Up late), Lan Anh\.$/,
  );
  expect(await sameDocument(page)).toBe(true);

  // After a reload everything is as she left it.
  await page.reload();
  await expect(greeting).toHaveText(/, Lan Anh\.$/);
  expect(await sameDocument(page)).toBe(false);
  expect(await shownPrefs(page)).toEqual({ ...changed, lang: 'en' });
  const api = await own.api();
  expect((await api.get<{ ui: unknown }>('/api/settings')).ui).toEqual({
    name: 'Lan Anh',
    language: 'en',
    theme: 'light',
    palette: 'hoa-dao',
    fontSize: 18,
  });
});

test('an API key is only ever shown as …last4 (F18.2)', async ({ page }) => {
  const own = await startServer();
  const key = 'sk-ant-e2e-0123456789-abcdefWXYZ';
  const leaks: string[] = [];
  page.on('response', async (response) => {
    const body = await response.text().catch(() => '');
    if (body.includes(key) || body.includes(key.slice(0, 20))) leaks.push(response.url());
  });
  await page.goto(`${own.origin}/#/settings`);
  const field = page.getByLabel('Khóa API Anthropic (Claude)');
  await field.fill(key);
  await page.getByRole('button', { name: 'Lưu khóa' }).click();
  await expect(page.getByText('Đã lưu khóa …WXYZ.')).toBeVisible();
  await expect(field).toHaveValue('');
  await page.reload();
  await expect(page.getByText('Đã lưu khóa …WXYZ.')).toBeVisible();
  const api = await own.api();
  const settings = await api.get<{ ai: { keys: Record<string, unknown> } }>('/api/settings');
  expect(settings.ai.keys['anthropic']).toEqual({ set: true, last4: '…WXYZ' });
  expect(JSON.stringify(settings)).not.toContain(key);
  // The global settings file is outside the vault: /files never serves it.
  expect(await api.status('/api/files?path=..%2F.secondbrain%2Fsettings.json')).toBe(400);
  expect(leaks).toEqual([]);
});

test('rebuilding the index shows progress; a note edited meanwhile is found afterwards (F18.4)', async ({
  page,
}) => {
  // Enough notes that the rebuild takes a moment and reports progress.
  const home = makeTempHome('e2e rebuild');
  const folder = path.join(home, 'vault', '2 Areas', 'Kho lớn');
  mkdirSync(folder, { recursive: true });
  for (let i = 0; i < 2500; i += 1) {
    writeFileSync(
      path.join(folder, `Ghi chú ${i}.md`),
      `# Ghi chú ${i}\n\nNội dung số ${i} về giải tích và [[Ghi chú ${(i + 1) % 2500}]].\n`,
    );
  }
  const own = await startServer(home);
  try {
    const api = await own.api();
    const target = '2 Areas/Kho lớn/Ghi chú 7.md';
    const search = async (q: string) =>
      (await api.get<{ results: { path: string }[] }>(`/api/search?q=${encodeURIComponent(q)}`))
        .results;
    // When the server said the rebuild was done, from its WebSocket events.
    let rebuiltAt: number | null = null;
    page.on('websocket', (socket) =>
      socket.on('framereceived', (frame) => {
        const event = JSON.parse(String(frame.payload)) as { type?: string; phase?: string };
        if (event.type === 'index:progress' && event.phase === 'done') rebuiltAt ??= Date.now();
      }),
    );
    await page.goto(`${own.origin}/#/settings`);
    await page.getByRole('button', { name: 'Xây lại chỉ mục' }).click();
    const progress = page.getByText(/^Đang xây lại chỉ mục: \d+\/\d+ tệp\.$/);
    await expect(progress).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Tiến độ xây lại chỉ mục' })).toBeVisible();
    await shot(page, 'settings-rebuild-progress');

    // During the rebuild: an edit goes in and search still answers from the old index.
    const note = await api.get<{ revision: string; content: string }>(
      `/api/note?path=${encodeURIComponent(target)}`,
    );
    await api.send('PUT', '/api/note', {
      path: target,
      content: `${note.content}\nTừ khóa mới: xylophonequahang\n`,
      expectedRevision: note.revision,
    });
    const editedAt = Date.now();
    expect((await search('giải tích')).length).toBeGreaterThan(0);

    await expect(page.getByText('Đã xây lại chỉ mục.')).toBeVisible({ timeout: 120_000 });
    expect(rebuiltAt, 'the edit was saved before the rebuild finished').toBeGreaterThan(editedAt);
    await expect
      .poll(async () => (await search('xylophonequahang')).map((r) => r.path))
      .toEqual([target]);
  } finally {
    await own.dispose();
    server = null;
    rmSync(home, { recursive: true, force: true });
  }
});
