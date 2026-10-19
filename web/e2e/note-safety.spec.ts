/// <reference lib="dom" />
// Data safety in a real browser: the save indicator tells the truth (server down, disk full),
// drafts survive a closed tab (SPEC F3.4, F3.5, F20.1), and two windows editing the same note end
// in the three-version conflict screen where "Giữ bản của tôi" keeps the disk copy in the trash
// (SPEC F3.6, §4.10).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import { cleanupNotes, trashEntries, vaultApi } from './helpers/vault-api.js';

test.afterEach(async ({ page }) => cleanupNotes(page));

const noteBody = (page: Page) => page.getByRole('textbox', { name: /Nội dung ghi chú/ });
const noteUrl = (notePath: string) => `/#/note?path=${encodeURIComponent(notePath)}`;
const isSave = (route: Route) => route.request().method() === 'PUT';

async function typeAtEnd(page: Page, text: string) {
  await noteBody(page).click();
  // Ctrl+End right after focusing can fire before the caret is inside the editor: press again
  // until the caret sits in the last block.
  await expect
    .poll(async () => {
      await page.keyboard.press('Control+End');
      return page.evaluate(() => {
        const last = document.querySelector('.ProseMirror')?.lastElementChild;
        const anchor = document.getSelection()?.anchorNode ?? null;
        return Boolean(last && anchor && last.contains(anchor));
      });
    })
    .toBe(true);
  await page.keyboard.type(text);
}

test('save states: disk full and server down show an error, keep the text, then save (F20.1)', async ({
  page,
}) => {
  const api = await vaultApi(page);
  const notePath = '1 Projects/Lưu an toàn.md';
  await api.createNote(notePath, '# Lưu an toàn\n\nĐoạn đầu.\n');
  await page.goto(noteUrl(notePath));
  await expect(noteBody(page)).toContainText('Đoạn đầu.');

  // A save in flight says so; "Đã lưu" only after the server answered.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/note', async (route) => {
    if (!isSave(route)) return route.fallback();
    await held;
    await route.fallback();
  });
  await typeAtEnd(page, ' Câu không.');
  await expect(page.getByText('Đang lưu…', { exact: true })).toBeVisible({ timeout: 5_000 });
  expect((await api.readNote(notePath)).content).not.toContain('Câu không.');
  release();
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible({ timeout: 5_000 });
  expect((await api.readNote(notePath)).content).toContain('Đoạn đầu. Câu không.');
  await page.unroute('**/api/note');

  // Disk full: the server answers WRITE_FAILED / ENOSPC.
  await page.route('**/api/note', async (route) => {
    if (!isSave(route)) return route.fallback();
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'WRITE_FAILED',
          message: 'disk full',
          details: { path: notePath, cause: 'ENOSPC' },
        },
      }),
    });
  });
  await typeAtEnd(page, ' Câu một.');
  await expect(page.getByText('Lỗi lưu', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/ổ đĩa đã đầy/)).toBeVisible();
  await page.unroute('**/api/note');
  await page.getByRole('button', { name: 'Thử lại' }).first().click();
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible({ timeout: 5_000 });
  expect((await api.readNote(notePath)).content).toContain('Câu không. Câu một.');

  // Server unreachable: the request never arrives; saving resumes once it is back.
  await page.route('**/api/note', (route) =>
    isSave(route) ? route.abort('connectionrefused') : route.fallback(),
  );
  await typeAtEnd(page, ' Câu hai.');
  await expect(page.getByText('Lỗi lưu', { exact: true })).toBeVisible({ timeout: 5_000 });
  await page.unroute('**/api/note');
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible({ timeout: 10_000 });
  expect((await api.readNote(notePath)).content).toContain('Câu một. Câu hai.');
});

test('a draft typed while the server is unreachable survives a killed tab and is restored (F3.5)', async ({
  browser,
  page,
}) => {
  const api = await vaultApi(page);
  const notePath = '1 Projects/Bản nháp e2e.md';
  await api.createNote(notePath, '# Bản nháp\n\nNội dung cũ.\n');
  const context = await browser.newContext();
  const first = await context.newPage();
  await first.goto(noteUrl(notePath));
  await expect(noteBody(first)).toContainText('Nội dung cũ.');
  // From here the page cannot reach the server at all (every request it makes fails), so the
  // save it attempts while closing never arrives either: the same as a tab killed mid-typing.
  await first.evaluate(() => {
    window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  });
  await typeAtEnd(first, ' Chữ chưa lưu.');
  await expect(first.getByText('Lỗi lưu', { exact: true })).toBeVisible({ timeout: 5_000 });
  await first.close();
  expect((await api.readNote(notePath)).content).not.toContain('Chữ chưa lưu.');

  const second = await context.newPage();
  await second.goto(noteUrl(notePath));
  await expect(second.getByText('Đã khôi phục bản nháp chưa lưu.')).toBeVisible();
  await expect(noteBody(second)).toContainText('Chữ chưa lưu.');
  await expect(second.getByText('Đã lưu', { exact: true })).toBeVisible({ timeout: 5_000 });
  expect((await api.readNote(notePath)).content).toContain('Nội dung cũ. Chữ chưa lưu.');
  await context.close();
});

test('two windows: the second save gets the conflict screen; keep mine trashes the disk copy (F3.6)', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const windowA = await context.newPage();
  const windowB = await context.newPage();
  const api = await vaultApi(windowA);
  const notePath = '1 Projects/Hai cửa sổ.md';
  await api.createNote(notePath, '# Hai cửa sổ\n\nDòng chung.\n');
  for (const page of [windowA, windowB]) {
    await page.goto(noteUrl(notePath));
    await expect(noteBody(page)).toContainText('Dòng chung.');
  }

  // B types first, but its save is held until A has saved.
  let releaseB: () => void = () => {};
  const held = new Promise<void>((resolve) => (releaseB = resolve));
  await windowB.route('**/api/note', async (route) => {
    if (!isSave(route)) return route.fallback();
    await held;
    await route.fallback();
  });
  await typeAtEnd(windowB, ' Bản của B.');
  await typeAtEnd(windowA, ' Bản của A.');
  await expect(windowA.getByText('Đã lưu', { exact: true })).toBeVisible({ timeout: 5_000 });
  releaseB();

  await expect(windowB.getByText('Ghi chú này vừa được sửa ở chỗ khác')).toBeVisible({
    timeout: 5_000,
  });
  for (const name of ['Tải lại', 'Giữ bản của tôi', 'So sánh']) {
    await expect(windowB.getByRole('button', { name })).toBeVisible();
  }
  await windowB.getByRole('button', { name: 'So sánh' }).click();
  await expect(windowB.getByText(/Bản của A\./).first()).toBeVisible();

  const trashBefore = trashEntries().length;
  await windowB.getByRole('button', { name: 'Giữ bản của tôi' }).click();
  await expect(windowB.getByText('Đã lưu', { exact: true })).toBeVisible({ timeout: 5_000 });
  const disk = (await api.readNote(notePath)).content;
  expect(disk).toContain('Bản của B.');
  expect(disk).not.toContain('Bản của A.');
  const conflictCopies = trashEntries()
    .slice(trashBefore)
    .filter((entry) => entry.reason === 'conflict');
  expect(conflictCopies).toHaveLength(1);
  const copy = readFileSync(path.join(conflictCopies[0]!.dir, 'files', notePath), 'utf8');
  expect(copy).toContain('Bản của A.');
  await context.close();
});
