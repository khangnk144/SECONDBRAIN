/// <reference lib="dom" />
// Scenario S3b (SPEC §2, F15): a lecture PDF dropped into a note is saved under its own name in
// the folder picked in "Lưu vào" and linked; the link opens the in-app viewer (page drawn, next
// page, zoom, Alt+W closes); images go to Attachments/<month>/ with unique names and render
// inline from a blob URL; an HTML file is only ever downloaded; "Tài liệu" lists the files with
// the notes that mention them. Own server per test: every run starts from a fresh vault.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { localIso, type AppApi } from './helpers/app-api.js';
import { dropFiles, multiPagePdf, solidPng } from './helpers/file-fixtures.js';
import { caretToEnd, newLastLine, noteBody, noteHash, noteTitle } from './helpers/note-page.js';
import { ownServer, UTF8_BROWSER, type OwnServer } from './helpers/own-server.js';
import { shot } from './helpers/screenshots.js';

test.use(UTF8_BROWSER);

let server: OwnServer;
test.beforeEach(async () => {
  server = ownServer(47690);
  await server.start();
});
test.afterEach(async () => server.dispose());

const lecture = '2 Areas/Buổi học đạo hàm.md';
const pdfName = 'bài giảng 3.pdf';
const pdfBytes = multiPagePdf(['Bai giang 3: dao ham', 'Trang hai', 'Trang ba']);
const png = solidPng(48, 32, [200, 60, 120]);
const html = Buffer.from('<!doctype html><h1>Trang web</h1><script>alert(1)</script>\n');

const vaultFile = (vaultPath: string) => path.join(server.vaultDir, ...vaultPath.split('/'));
const readLecture = (api: AppApi) =>
  api.get<{ content: string }>(`/api/note?path=${encodeURIComponent(lecture)}`);

/** Dark pixels drawn on the canvas of `page` (a blank page has none). */
const darkPixels = (page: Page, pageNumber: number) =>
  page.locator(`.pdf-page[data-page="${pageNumber}"] canvas`).evaluate((canvas) => {
    const c = canvas as HTMLCanvasElement;
    const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! < 80 && data[i + 1]! < 80 && data[i + 2]! < 80 && data[i + 3]! > 0) dark += 1;
    }
    return dark;
  });

async function openLecture(page: Page) {
  await page.goto(`${server.origin}/${noteHash(lecture)}`);
  await expect(noteTitle(page)).toHaveValue('Buổi học đạo hàm');
  await expect(noteBody(page)).toContainText('Ghi chép trên lớp.');
}

test('S3b: drop a lecture PDF, open it in the viewer; images inline; HTML only downloads (F15.1–F15.3)', async ({
  page,
}) => {
  test.slow();
  const api = await server.api();
  await api.send('POST', '/api/note', {
    path: lecture,
    content: '---\ntype: lecture\n---\n\n# Buổi học đạo hàm\n\nGhi chép trên lớp.\n',
  });
  await openLecture(page);

  // The PDF: "Lưu vào" asks once, "Bài báo" puts it in 3 Resources/papers under its own name.
  await dropFiles(await newLastLine(page), [
    { name: pdfName, type: 'application/pdf', bytes: pdfBytes },
  ]);
  const chooser = page.getByRole('dialog', { name: 'Lưu vào' });
  await expect(chooser).toContainText(pdfName);
  await chooser.getByRole('radio', { name: /Bài báo/ }).check();
  await chooser.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(chooser).toHaveCount(0);
  const pdfPath = `3 Resources/papers/${pdfName}`;
  await expect.poll(() => existsSync(vaultFile(pdfPath))).toBe(true);
  expect(readFileSync(vaultFile(pdfPath)).equals(pdfBytes)).toBe(true);
  const pdfLink = noteBody(page).locator('.wikilink', { hasText: pdfName });
  await expect(pdfLink).toBeVisible();
  await expect.poll(async () => (await readLecture(api)).content).toContain(`[[${pdfName}]]`);

  // Two images named image.png: Attachments/<month>/, unique names, both drawn from blob URLs.
  const month = localIso().slice(0, 7);
  for (const expected of ['image.png', 'image 2.png']) {
    await dropFiles(await newLastLine(page), [
      { name: 'image.png', type: 'image/png', bytes: png },
    ]);
    await expect.poll(() => existsSync(vaultFile(`Attachments/${month}/${expected}`))).toBe(true);
    await expect.poll(async () => (await readLecture(api)).content).toContain(`![[${expected}]]`);
  }
  const images = noteBody(page).locator('img.embed-image__img');
  await expect(images).toHaveCount(2);
  const sources = await images.evaluateAll((list) =>
    list.map((img) => ({
      src: img.getAttribute('src') ?? '',
      width: (img as HTMLImageElement).naturalWidth,
    })),
  );
  for (const source of sources) {
    expect(source.src).toMatch(/^blob:/);
    expect(source.width).toBe(48);
  }
  expect(sources[0]!.src).not.toBe(sources[1]!.src);

  // An HTML page goes to 3 Resources/other (the chooser's choice for it) and is linked.
  const htmlName = 'trang bài giảng.html';
  await dropFiles(await newLastLine(page), [{ name: htmlName, type: 'text/html', bytes: html }]);
  await chooser.getByRole('radio', { name: 'Tài liệu khác' }).check();
  await chooser.getByRole('button', { name: 'Lưu', exact: true }).click();
  const htmlPath = `3 Resources/other/${htmlName}`;
  await expect.poll(() => existsSync(vaultFile(htmlPath))).toBe(true);
  await expect.poll(async () => (await readLecture(api)).content).toContain(`[[${htmlName}]]`);
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible({ timeout: 10_000 });
  await shot(page, 'attachments-note');

  // Clicking the HTML link downloads it: no navigation, no frame, attachment header.
  const before = page.url();
  const download = page.waitForEvent('download');
  const served = page.waitForResponse(
    (r) => r.url().includes('/api/files?') && r.url().includes('download=1'),
  );
  await noteBody(page).locator('.wikilink', { hasText: htmlName }).click();
  expect((await served).headers()['content-disposition']).toMatch(/^attachment/);
  expect((await download).suggestedFilename()).toBe(htmlName);
  expect(page.url()).toBe(before);
  expect(page.frames()).toHaveLength(1);
  expect(page.context().pages()).toHaveLength(1);
  await expect(page.getByText(`Đã tải ${htmlName} về máy.`)).toBeVisible();
  // Even without download=1 the server never serves vault HTML inline (SPEC §5).
  const direct = await page.request.get(
    `${server.origin}/api/files?path=${encodeURIComponent(htmlPath)}`,
    { headers: { 'X-SB-Token': api.token } },
  );
  expect(direct.headers()['content-disposition']).toMatch(/^attachment/);
  expect(direct.headers()['x-content-type-options']).toBe('nosniff');

  // The PDF link opens the viewer tab: page 1 drawn, next page, zoom, Alt+W closes the tab.
  await pdfLink.click();
  await expect(page).toHaveURL(/#\/file\?path=3%20Resources%2Fpapers%2F/);
  const toolbar = page.getByRole('toolbar', { name: 'Công cụ xem PDF' });
  await expect(toolbar).toBeVisible();
  await expect.poll(() => darkPixels(page, 1).catch(() => 0)).toBeGreaterThan(1_000);
  const pageField = toolbar.getByRole('textbox', { name: 'Số trang, trong 3 trang' });
  await expect(pageField).toHaveValue('1');
  await toolbar.getByRole('button', { name: 'Trang sau' }).click();
  await expect(pageField).toHaveValue('2');
  await expect.poll(() => darkPixels(page, 2).catch(() => 0)).toBeGreaterThan(1_000);
  const zoom = toolbar.locator('.pdf-toolbar__zoom');
  const fitted = await zoom.textContent();
  await toolbar.getByRole('button', { name: 'Phóng to' }).click();
  await expect(zoom).not.toHaveText(fitted ?? '');
  await expect(toolbar.getByRole('button', { name: 'Vừa chiều rộng' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  const tabs = page.getByRole('navigation', { name: 'Thẻ ghi chú đang mở' }).locator('.tab');
  await expect(tabs.filter({ hasText: pdfName })).toHaveCount(1);
  await shot(page, 'attachments-pdf-viewer');
  await page.keyboard.press('Alt+w');
  await expect(tabs.filter({ hasText: pdfName })).toHaveCount(0);
  await expect(page).not.toHaveURL(/#\/file/);

  // "Tài liệu" lists the PDF, both images and the page, each mentioned in the lecture.
  await page.goto(`${server.origin}/#/resources`);
  await expect(page.getByRole('heading', { level: 1, name: 'Tài liệu' })).toBeVisible();
  for (const name of [pdfName, 'image.png', 'image 2.png', htmlName]) {
    const row = page.locator('.resource-row').filter({
      has: page.getByRole('button', { name, exact: true }),
    });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.resource-row__refs')).toHaveText('Được nhắc trong Buổi học đạo hàm');
  }
  await shot(page, 'attachments-resources');
});

test('a missing image shows a placeholder naming the file; the note is never rewritten (F15.2)', async ({
  page,
}) => {
  const api = await server.api();
  const source = '# Ảnh thiếu\n\n![[không có.png]]\n';
  const created = await api.send<{ revision: string }>('POST', '/api/note', {
    path: '0 Inbox/Ảnh thiếu.md',
    content: source,
  });
  await page.goto(`${server.origin}/${noteHash('0 Inbox/Ảnh thiếu.md')}`);
  await expect(noteBody(page)).toContainText('Không tìm thấy ảnh không có.png');
  await expect(noteBody(page).locator('img.embed-image__img')).toHaveCount(0);
  await expect(noteBody(page).locator('.embed-placeholder')).toHaveCount(1);
  await caretToEnd(page);
  await page.waitForTimeout(1_000);
  const after = await api.get<{ content: string; revision: string }>(
    `/api/note?path=${encodeURIComponent('0 Inbox/Ảnh thiếu.md')}`,
  );
  expect(after).toMatchObject({ content: source, revision: created.revision });
});
