/// <reference lib="dom" />
// PDF text in search and Documents (SPEC F30.1, F30.2): a text PDF dropped into a note and saved
// to 3 Resources/papers (the attachment flow) is searchable within 10 s, diacritic-insensitively;
// the palette names the page ("tr. 2") and Enter opens the viewer at that page. A blank PDF
// copied into the folder shows "Không đọc được chữ" in Documents and never blocks anything.
// Own server: every run starts from a fresh vault.
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { dropFiles, multiPagePdf } from './helpers/file-fixtures.js';
import { newLastLine, noteBody, noteHash, noteTitle } from './helpers/note-page.js';
import { ownServer, UTF8_BROWSER, type OwnServer } from './helpers/own-server.js';
import { shot } from './helpers/screenshots.js';

test.use(UTF8_BROWSER);

let server: OwnServer;
test.beforeEach(async () => {
  server = ownServer(47698);
  await server.start();
});
test.afterEach(async () => server.dispose());

const LECTURE = '2 Areas/Buổi học ma trận.md';
const PDF_NAME = 'bài báo Cramer.pdf';
const PDF_PATH = `3 Resources/papers/${PDF_NAME}`;
// Two rows a page, 40+ letters each: fewer on 30 % of the pages counts as "partly readable".
const PDF = multiPagePdf([
  'Bai bao mau: ma tran va dinh thuc\nHang cua ma tran va cac phep bien doi',
  'Phuong phap Cramer giai he phuong trinh\nbang cach tinh cac dinh thuc con',
  'Trang ba: ket luan cua bai bao\nva cac huong nghien cuu tiep theo',
]);
const BLANK_PATH = '3 Resources/papers/bản scan trắng.pdf';

interface Hit {
  path: string;
  page?: number;
}

test('a dropped text PDF is found by a word of page 2 within 10 s; Enter opens it at page 2 (F30.1)', async ({
  page,
}) => {
  const api = await server.api();
  await api.send('POST', '/api/note', {
    path: LECTURE,
    content: '# Buổi học ma trận\n\nGhi chép trên lớp.\n',
  });
  await page.goto(`${server.origin}/${noteHash(LECTURE)}`);
  await expect(noteTitle(page)).toHaveValue('Buổi học ma trận');
  await expect(noteBody(page)).toContainText('Ghi chép trên lớp.');

  await dropFiles(await newLastLine(page), [
    { name: PDF_NAME, type: 'application/pdf', bytes: PDF },
  ]);
  const chooser = page.getByRole('dialog', { name: 'Lưu vào' });
  await chooser.getByRole('radio', { name: /Bài báo/ }).check();
  await chooser.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect
    .poll(() => existsSync(path.join(server.vaultDir, ...PDF_PATH.split('/'))))
    .toBe(true);
  const landed = Date.now();

  // Searchable within 10 s of landing; the query has diacritics, the PDF has none.
  const query = 'phương pháp Cramer';
  await expect
    .poll(
      async () => {
        const found = await api.get<{ results: Hit[] }>(
          `/api/search?q=${encodeURIComponent(query)}`,
        );
        return found.results.find((r) => r.path === PDF_PATH)?.page ?? null;
      },
      { timeout: 10_000, intervals: [250] },
    )
    .toBe(2);
  const searchableAfterMs = Date.now() - landed;
  console.log(`PDF searchable ${searchableAfterMs} ms after landing`);
  expect(searchableAfterMs).toBeLessThan(10_000);

  // The palette: the PDF row says "tr. 2"; Enter opens the viewer at page 2.
  await page.keyboard.press('Control+k');
  await page.keyboard.type(query);
  const row = page.locator('.palette-option').filter({ hasText: PDF_NAME.replace('.pdf', '') });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.palette-option__page')).toHaveText('tr. 2');
  await shot(page, 'pdf-palette-page-1280');
  for (let i = 0; i < 10 && !(await row.getAttribute('class'))?.includes('is-active'); i += 1) {
    await page.keyboard.press('ArrowDown');
  }
  await expect(row).toHaveClass(/is-active/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/file\?path=3%20Resources%2Fpapers%2Fb/);
  const toolbar = page.getByRole('toolbar', { name: 'Công cụ xem PDF' });
  await expect(toolbar.getByRole('textbox', { name: 'Số trang, trong 3 trang' })).toHaveValue('2');
});

test('a blank PDF shows "Không đọc được chữ" in Documents; saving notes is unaffected (F30.2)', async ({
  page,
}) => {
  const api = await server.api();
  writeFileSync(path.join(server.vaultDir, ...BLANK_PATH.split('/')), multiPagePdf(['', '']));
  writeFileSync(path.join(server.vaultDir, ...PDF_PATH.split('/')), PDF);
  await page.goto(`${server.origin}/#/resources`);
  await expect(page.getByRole('heading', { level: 1, name: 'Tài liệu' })).toBeVisible();
  const blank = page.locator('.resource-row').filter({
    has: page.getByRole('button', { name: 'bản scan trắng.pdf', exact: true }),
  });
  await expect(blank).toContainText('Không đọc được chữ', { timeout: 15_000 });
  await expect(blank).toContainText('Có thể đây là bản scan.');
  // The text PDF shows no text state at all (only problems are shown).
  const text = page.locator('.resource-row').filter({
    has: page.getByRole('button', { name: PDF_NAME, exact: true }),
  });
  await expect(text).toBeVisible();
  await expect
    .poll(async () => (await api.get<{ results: Hit[] }>('/api/search?q=Cramer')).results.length)
    .toBeGreaterThan(0);
  await expect(text).not.toContainText('đọc');
  await shot(page, 'pdf-documents-states-1280');
  await page.setViewportSize({ width: 360, height: 740 });
  await shot(page, 'pdf-documents-states-360');

  // A save meanwhile works as always.
  const created = await api.send<{ revision: string }>('POST', '/api/note', {
    path: '0 Inbox/Ghi chú.md',
    content: 'Vẫn lưu được.\n',
  });
  expect(created.revision).toBeTruthy();
});
