/// <reference lib="dom" />
// The generated "Học kỳ này" page (F25.1–F25.3) in a real browser, Bento style: off by default
// (no file, no state), turned on in Settings → Kho ghi chú, the page at the vault root with
// courses, lectures and projects grouped by course; read-only in the editor with its banner and a
// link back to Settings; a project tick shows on the page within ~2 s; renaming it from the tree
// is refused in words; an edit made outside the app is never overwritten, and "Tạo lại" puts that
// copy in the trash (`generated-replaced`) first; turned off, the file stays and can go to the
// trash with undo; the palette command only while it is on.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { isoAddDays, localIso } from './helpers/app-api.js';
import { createNote, readVault, rewriteNote, vaultFile } from './helpers/m5-app.js';
import { noteBody, noteTitle } from './helpers/note-page.js';
import { ownServer, type OwnServer } from './helpers/own-server.js';

let server: OwnServer;
test.beforeEach(async () => {
  server = ownServer(47695, { style: 'bento' });
  await server.start();
});
test.afterEach(async () => server.dispose());

const PAGE = 'Học kỳ này.md';
const COURSE = '2 Areas/Giải tích 1.md';
const PROJECT = '1 Projects/Đồ án Giải tích.md';
const T = localIso();

const projectText = (done: number) =>
  `---\ntype: project\nstatus: doing\ncourse: "[[Giải tích 1]]"\ndeadline: ${isoAddDays(T, 12)}\n---\n\n# Đồ án Giải tích\n\n` +
  ['Chọn đề tài', 'Viết báo cáo', 'Nộp bài']
    .map((task, i) => (i < done ? `- [x] ${task} ✅ ${T}` : `- [ ] ${task}`))
    .join('\n') +
  '\n';

function trashMetas(server: OwnServer): { reason: string; originalPaths: string[] }[] {
  const dir = path.join(server.vaultDir, '.secondbrain', 'trash');
  let ids: string[];
  try {
    ids = readdirSync(dir);
  } catch {
    return [];
  }
  return ids.map((id) => JSON.parse(readFileSync(path.join(dir, id, 'meta.json'), 'utf8')));
}

const semesterSwitch = (page: Page) => page.getByRole('switch', { name: 'Trang Học kỳ này' });
const row = (page: Page) => page.locator('.semester-page-row');

test('on, read-only, live, refused rename, outside edit kept, "Tạo lại", off and trash (F25.1–F25.3)', async ({
  page,
}) => {
  test.slow();
  const api = await server.api();
  await createNote(api, COURSE, '---\ntype: course\n---\n\n# Giải tích 1\n');
  await createNote(
    api,
    '2 Areas/Bài 1 Giới hạn.md',
    '---\ntype: lecture\ncourse: "[[Giải tích 1]]"\n---\n\n# Bài 1\n',
  );
  await createNote(api, PROJECT, projectText(1));
  await createNote(
    api,
    '1 Projects/Đồ án tự do.md',
    '---\ntype: project\nstatus: doing\n---\n\n# Đồ án tự do\n',
  );

  // Off by default: no page, no state file (F1.1 unchanged).
  expect((await api.get<{ enabled: boolean }>('/api/semester-page')).enabled).toBe(false);
  expect(readVault(server, PAGE)).toBeNull();
  expect(readVault(server, '.secondbrain/state/semester-page.json')).toBeNull();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${server.origin}/#/settings`);
  await expect(semesterSwitch(page)).not.toBeChecked();
  await semesterSwitch(page).check();
  await expect(
    row(page).getByText('Đã bật. Trang Học kỳ này nằm ở gốc kho ghi chú.'),
  ).toBeVisible();
  await expect.poll(() => readVault(server, PAGE)).toContain('generated: true');
  const page1 = readVault(server, PAGE)!;
  for (const part of [
    '## Môn học',
    '[[Giải tích 1]]',
    '## Đồ án',
    '### [[Giải tích 1]]',
    '[[Đồ án Giải tích]]',
    'xong 1/3 việc',
    '### Khác',
    '[[Đồ án tự do]]',
    'còn 12 ngày',
  ]) {
    expect(page1, part).toContain(part);
  }

  // Opened in the app: banner, read-only title and body, no PUT.
  const puts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes('/api/note')) puts.push(request.url());
  });
  await row(page).getByRole('button', { name: 'Mở trang' }).click();
  await expect(noteTitle(page)).toHaveValue('Học kỳ này');
  await expect(
    page.getByText('Trang này do app tạo tự động. Muốn đổi thì sửa các ghi chú môn học và đồ án.'),
  ).toBeVisible();
  await expect(noteTitle(page)).toHaveAttribute('readonly', '');
  await expect(noteBody(page)).toHaveAttribute('contenteditable', 'false');
  await expect(page.getByRole('button', { name: 'Thêm thuộc tính' })).toHaveCount(0);
  await noteBody(page).click();
  await page.keyboard.type('chữ không được ghi');
  await page.waitForTimeout(1_500);
  expect(puts).toEqual([]);
  expect(readVault(server, PAGE)).toBe(page1);

  // A project tick reaches the page within ~2 s.
  await rewriteNote(api, PROJECT, projectText(2));
  await expect.poll(() => readVault(server, PAGE), { timeout: 3_000 }).toContain('xong 2/3 việc');

  // Renaming the page from the tree is refused, in words.
  const item = page
    .getByRole('complementary', { name: 'Thư mục' })
    .getByRole('treeitem', { name: 'Học kỳ này' });
  await item.focus();
  await page.keyboard.press('F2');
  const rename = page.getByRole('complementary', { name: 'Thư mục' }).getByRole('textbox');
  await expect(rename).toBeFocused();
  await rename.fill('Học kỳ khác');
  await page.keyboard.press('Enter');
  await expect(
    page.getByText(/^Trang Học kỳ này do app tạo nên không sửa, đổi tên hay di chuyển được\./),
  ).toBeVisible();
  expect(readVault(server, PAGE)).toContain('xong 2/3 việc');
  expect(readVault(server, 'Học kỳ khác.md')).toBeNull();

  // "Cài đặt" in the banner focuses the switch.
  await page.locator('[data-generated-page]').getByRole('link', { name: 'Cài đặt' }).click();
  await expect(page).toHaveURL(/#\/settings\?focus=semester-page/);
  await expect(semesterSwitch(page)).toBeFocused();

  // Edited outside the app: never overwritten; Settings and the banner say so.
  const outside = `${readVault(server, PAGE)}\nSửa tay bằng Notepad.\n`;
  writeFileSync(vaultFile(server, PAGE), outside);
  await expect(row(page).locator('.settings-field__notice')).toHaveText(
    /^Trang Học kỳ này đã được sửa bên ngoài app, nên app không ghi đè nữa\./,
  );
  await rewriteNote(api, PROJECT, projectText(3));
  await page.waitForTimeout(2_500);
  expect(readVault(server, PAGE)).toBe(outside);
  await row(page).getByRole('button', { name: 'Mở trang' }).click();
  const banner = page.locator('[data-generated-page]');
  await expect(banner).toContainText('Trang này đã được sửa bên ngoài app');

  // "Tạo lại" asks, then the edited copy goes to the trash and a fresh page is written.
  await banner.getByRole('button', { name: 'Tạo lại' }).click();
  const confirm = page.getByRole('dialog', { name: 'Tạo lại trang Học kỳ này?' });
  await confirm.getByRole('button', { name: 'Tạo lại' }).click();
  await expect.poll(() => readVault(server, PAGE)).toContain('xong 3/3 việc');
  expect(readVault(server, PAGE)).not.toContain('Sửa tay');
  const replaced = trashMetas(server).find((meta) => meta.reason === 'generated-replaced');
  expect(replaced?.originalPaths).toEqual([PAGE]);
  // The page stays open and shows the fresh page with the ordinary banner (E2E D2: the tab used
  // to close with the trashed copy and fall back to Today).
  await expect(banner).toContainText('Trang này do app tạo tự động.');
  await expect(banner).not.toContainText('sửa bên ngoài app');
  await expect(page).toHaveURL(/#\/note\?path=/);
  await expect(page.getByRole('textbox', { name: /Tiêu đề ghi chú/ })).toHaveValue('Học kỳ này');
  await expect(page.locator('.note-screen')).toContainText('xong 3/3 việc');
  await page.waitForTimeout(1_500); // the deletion event of the edited copy has long arrived
  await expect(page).toHaveURL(/#\/note\?path=/);

  // The palette offers the page while it is on.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('>mở trang học');
  await expect(page.locator('.palette-option').first()).toContainText('Mở trang Học kỳ này');
  await page.keyboard.press('Escape');

  // Off: the file stays and is an ordinary note; then to the trash with undo.
  await page.goto(`${server.origin}/#/settings`);
  await semesterSwitch(page).uncheck();
  await expect(row(page).getByText('Đã tắt. Trang Học kỳ này vẫn còn trong kho.')).toBeVisible();
  expect(readVault(server, PAGE)).toContain('generated: true');
  await expect(
    row(page).getByText('Trang Học kỳ này vẫn còn trong kho như một ghi chú thường.'),
  ).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('>mở trang học');
  await expect(
    page.locator('.palette-option').filter({ hasText: 'Mở trang Học kỳ này' }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await row(page).getByRole('button', { name: 'Chuyển trang vào thùng rác' }).click();
  await expect.poll(() => readVault(server, PAGE)).toBeNull();
  await expect(page.getByText('Đã chuyển trang Học kỳ này vào thùng rác.')).toBeVisible();
  await page
    .getByRole('region', { name: 'Thông báo' })
    .getByRole('button', { name: 'Hoàn tác' })
    .click();
  await expect.poll(() => readVault(server, PAGE)).toContain('generated: true');
});

test('the English UI names the page "This semester.md" when it is turned on (F25.1)', async ({
  page,
}) => {
  const api = await server.api();
  await createNote(api, COURSE, '---\ntype: course\n---\n\n# Giải tích 1\n');
  await api.send('PUT', '/api/settings', { ui: { language: 'en' } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${server.origin}/#/settings`);
  await page.getByRole('switch', { name: 'This semester page' }).check();
  await expect.poll(() => readVault(server, 'This semester.md')).toContain('generated: true');
  expect(readVault(server, PAGE)).toBeNull();
});
