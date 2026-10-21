/// <reference lib="dom" />
// The vault part of Settings (SPEC F18.3, F18.5) through the UI: switching A → B → A with a note
// of the same path in both and words typed in A just before the switch (each vault keeps its
// content and tabs; an unusable folder is refused and A stays open), and a backup exported as a
// zip, then restored into a new folder that opens as the vault with notes, attachment, links,
// reminder state and trash intact. Own server per test (the open vault is server state).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, request as apiRequest, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { isoAddDays, localIso, type AppApi } from './helpers/app-api.js';
import { solidPng } from './helpers/file-fixtures.js';
import { appReady } from './helpers/keyboard.js';
import { caretToEnd, noteBody, noteHash, noteTitle } from './helpers/note-page.js';
import { makeTempHome, ownServer, UTF8_BROWSER, type OwnServer } from './helpers/own-server.js';
import { shot } from './helpers/screenshots.js';

test.use(UTF8_BROWSER);

let server: OwnServer;
const extraDirs: string[] = [];
test.beforeEach(async () => {
  server = ownServer(47693);
  await server.start();
});
test.afterEach(async () => {
  await server.dispose();
  for (const dir of extraDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const project = '1 Projects/Đồ án.md';
const tabs = (page: Page) =>
  page.getByRole('navigation', { name: 'Thẻ ghi chú đang mở' }).locator('.tab');
const openPath = (page: Page) => page.locator('.settings-path');
const readNote = (api: AppApi, notePath: string) =>
  api.get<{ content: string; revision: string }>(`/api/note?path=${encodeURIComponent(notePath)}`);

/** Settings → "Mở thư mục khác…" → `folder` → "Mở". */
async function switchVault(page: Page, folder: string) {
  await page.keyboard.press('Alt+,');
  await expect(page.getByRole('heading', { level: 1, name: 'Cài đặt' })).toBeVisible();
  await page.getByRole('button', { name: 'Mở thư mục khác…' }).click();
  await page.getByLabel('Đường dẫn thư mục').fill(folder);
  await page.getByRole('button', { name: 'Mở', exact: true }).click();
}

test('switching vault A → B → A keeps each vault’s notes and tabs; a missing folder is refused (F18.3)', async ({
  page,
}) => {
  const api = await server.api();
  const vaultA = server.vaultDir;
  const parentB = makeTempHome('kho B');
  extraDirs.push(parentB);
  const vaultB = path.join(parentB, 'Kho học kỳ 2');
  mkdirSync(path.join(vaultB, '1 Projects'), { recursive: true });
  writeFileSync(path.join(vaultB, ...project.split('/')), '# Đồ án\n\nNội dung kho B.\n');
  await api.send('POST', '/api/note', { path: project, content: '# Đồ án\n\nNội dung kho A.\n' });
  await api.send('POST', '/api/note', { path: '1 Projects/Chỉ ở A.md', content: '# Chỉ ở A\n' });

  // A: two tabs, words typed into "Đồ án" and the switch asked for at once.
  await page.goto(`${server.origin}/${noteHash('1 Projects/Chỉ ở A.md')}`);
  await appReady(page);
  await expect(noteTitle(page)).toHaveValue('Chỉ ở A');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Đồ án');
  await expect(page.locator('.palette-option').first()).toContainText('Đồ án');
  await page.keyboard.press('Control+Enter');
  await expect(tabs(page)).toHaveCount(2);
  await expect(noteBody(page)).toContainText('Nội dung kho A.');
  await caretToEnd(page);
  await page.keyboard.type(' gõ dở trong A');
  await switchVault(page, vaultB);
  await expect(openPath(page)).toHaveText(vaultB, { timeout: 15_000 });
  expect((await readNote(api, project)).content).toBe('# Đồ án\n\nNội dung kho B.\n');
  expect(readFileSync(path.join(vaultA, ...project.split('/')), 'utf8')).toContain(
    'Nội dung kho A. gõ dở trong A',
  );

  // B: none of A's tabs (only the note opened here); its own "Đồ án" without A's words or a
  // draft banner.
  await page.goto(`${server.origin}/${noteHash(project)}`);
  await expect(noteBody(page)).toContainText('Nội dung kho B.');
  await expect(tabs(page)).toHaveCount(1);
  await expect(noteBody(page)).not.toContainText('gõ dở');
  await expect(page.getByText('Đã khôi phục bản nháp chưa lưu.')).toHaveCount(0);
  await caretToEnd(page);
  await page.keyboard.type(' nháp trong B');
  await switchVault(page, vaultA);
  await expect(openPath(page)).toHaveText(vaultA, { timeout: 15_000 });
  expect(readFileSync(path.join(vaultB, ...project.split('/')), 'utf8')).toContain(
    'Nội dung kho B. nháp trong B',
  );

  // A again: its two tabs are back (the tab bar shows on note screens) and "Đồ án" has A's
  // words only.
  await page.goto(`${server.origin}/${noteHash('1 Projects/Chỉ ở A.md')}`);
  await expect(noteTitle(page)).toHaveValue('Chỉ ở A');
  await expect(tabs(page)).toHaveCount(2);
  await tabs(page).filter({ hasText: 'Đồ án' }).click();
  await expect(noteBody(page)).toContainText('Nội dung kho A. gõ dở trong A');
  await expect(noteBody(page)).not.toContainText('kho B');
  await expect(page.getByText('Đã khôi phục bản nháp chưa lưu.')).toHaveCount(0);

  // A folder that does not exist: the message says so and A stays open.
  await switchVault(page, path.join(parentB, 'Không có thư mục này'));
  await expect(
    page.getByText('Không tìm thấy thư mục này. Kiểm tra lại đường dẫn nhé.'),
  ).toBeVisible();
  await shot(page, 'settings-vault-switch-error');
  await expect(openPath(page)).toHaveText(vaultA);
  expect((await api.get<{ vault: { path: string } }>('/api/settings')).vault.path).toBe(vaultA);
  expect((await readNote(api, project)).content).toContain('gõ dở trong A');
});

test('backup export → "Khôi phục thử…" into a new folder opens an intact copy (F18.5)', async ({
  page,
}) => {
  test.slow();
  let api = await server.api();
  const month = localIso().slice(0, 7);
  // Notes with a link and an embedded image, a deadline that gets reminded, a trashed note.
  const upload = await page.request.post(`${server.origin}/api/attachments`, {
    headers: { 'X-SB-Token': api.token, Origin: server.origin },
    multipart: {
      target: 'auto',
      file: { name: 'sơ đồ.png', mimeType: 'image/png', buffer: solidPng(40, 30, [20, 120, 90]) },
    },
  });
  expect(upload.status(), await upload.text()).toBe(201);
  await api.send('POST', '/api/note', {
    path: project,
    content: `---\ntype: project\ndeadline: ${isoAddDays(localIso(), 1)}\n---\n\n# Đồ án\n\nXem [[Tài liệu tham khảo]].\n\n![[sơ đồ.png]]\n`,
  });
  await api.send('POST', '/api/note', {
    path: '3 Resources/Tài liệu tham khảo.md',
    content: '# Tài liệu tham khảo\n',
  });
  const dropped = await api.send<{ revision: string }>('POST', '/api/note', {
    path: '0 Inbox/Bỏ đi.md',
    content: 'Ghi chú bỏ đi.\n',
  });
  await api.send('POST', '/api/note/trash', {
    paths: ['0 Inbox/Bỏ đi.md'],
    expectedRevisions: [dropped.revision],
  });
  // Reminder time already passed today, then a restart: the start-up check reminds at once.
  await api.send('PUT', '/api/settings', { reminders: { time: '00:00' } });
  await server.stop();
  await server.start();
  api = await server.api();
  const stateFile = path.join(server.vaultDir, '.secondbrain', 'state', 'reminders.json');
  await expect.poll(() => existsSync(stateFile)).toBe(true);
  await expect
    .poll(async () => (await api.get<{ reminders: unknown[] }>('/api/reminders')).reminders)
    .toHaveLength(1);

  // Export through the UI: a zip download without the cache and without secrets.
  await page.goto(`${server.origin}/#/settings`);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất bản sao lưu…' }).click();
  const zipPath = path.join(server.home, 'tải về', (await download).suggestedFilename());
  expect(path.basename(zipPath)).toMatch(/^second-brain-sao-luu-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);
  await (await download).saveAs(zipPath);
  await expect(page.getByText(/^Đã tải bản sao lưu về máy: /)).toBeVisible();
  const zipBytes = readFileSync(zipPath);
  const entries = Object.keys(unzipSync(zipBytes));
  expect(entries).toEqual(
    expect.arrayContaining([
      project,
      '3 Resources/Tài liệu tham khảo.md',
      `Attachments/${month}/sơ đồ.png`,
      '.secondbrain/state/reminders.json',
      '.secondbrain/vault.json',
    ]),
  );
  expect(entries.some((e) => /^\.secondbrain\/trash\/[^/]+\/meta\.json$/.test(e))).toBe(true);
  expect(entries.filter((e) => e.startsWith('.secondbrain/cache/'))).toEqual([]);
  expect(zipBytes.includes(Buffer.from(api.token))).toBe(false);

  // "Khôi phục thử…" into a folder that does not exist yet: the app reloads into the copy.
  const restoreParent = makeTempHome('khôi phục');
  extraDirs.push(restoreParent);
  const restored = path.join(restoreParent, 'Kho khôi phục');
  await page.getByRole('button', { name: 'Khôi phục thử…' }).click();
  await page.getByLabel('Tệp sao lưu (.zip)').setInputFiles(zipPath);
  await page.getByLabel('Thư mục để khôi phục vào').fill(restored);
  await page.getByRole('button', { name: 'Khôi phục và mở' }).click();
  await expect(openPath(page)).toHaveText(restored, { timeout: 30_000 });

  // On disk: the same bytes for notes and attachment; the trash came along; the copy is a vault
  // of its own (new id) and every reminder entry came along under that id (so nothing is
  // reminded twice, see the test below).
  const same = (rel: string) =>
    expect(readFileSync(path.join(restored, ...rel.split('/')))).toEqual(
      readFileSync(path.join(server.vaultDir, ...rel.split('/'))),
    );
  same(project);
  same(`Attachments/${month}/sơ đồ.png`);
  expect(readdirSync(path.join(restored, '.secondbrain', 'trash')).length).toBe(1);
  const vaultId = (vault: string) =>
    (
      JSON.parse(readFileSync(path.join(vault, '.secondbrain', 'vault.json'), 'utf8')) as {
        id: string;
      }
    ).id;
  const restoredId = vaultId(restored);
  expect(restoredId).not.toBe(vaultId(server.vaultDir));
  const reminderEntries = (vault: string) =>
    (
      JSON.parse(
        readFileSync(path.join(vault, '.secondbrain', 'state', 'reminders.json'), 'utf8'),
      ) as { entries: { key: string }[] }
    ).entries;
  const original = reminderEntries(server.vaultDir);
  expect(original).toHaveLength(1);
  expect(reminderEntries(restored)).toEqual(
    expect.arrayContaining(
      original.map((entry) => ({ ...entry, key: entry.key.replace(/^[^|]+\|/, `${restoredId}|`) })),
    ),
  );

  // In the app: the link shows in the target's backlinks, the image renders.
  await page.goto(`${server.origin}/${noteHash('3 Resources/Tài liệu tham khảo.md')}`);
  const panel = page.getByRole('complementary', { name: 'Ngăn bên phải' });
  const backlinks = panel.getByRole('region', { name: /^Liên kết đến đây/ });
  await expect(backlinks.getByRole('button', { name: /Đồ án/ })).toBeVisible({ timeout: 10_000 });
  await page.goto(`${server.origin}/${noteHash(project)}`);
  await expect(noteBody(page).locator('img.embed-image__img')).toHaveAttribute('src', /^blob:/);
  await shot(page, 'settings-restored-vault');
  api = await server.api();
  expect((await api.get<{ vault: { path: string } }>('/api/settings')).vault.path).toBe(restored);
});

test('a restored copy does not remind again what the backup already reminded (F17, F18.5)', async () => {
  // Through the API (the UI path is the test above): one reminder fired, export, restore + open.
  let api = await server.api();
  await api.send('POST', '/api/note', {
    path: project,
    content: `---\ntype: project\ndeadline: ${isoAddDays(localIso(), 1)}\n---\n\n# Đồ án\n`,
  });
  await api.send('PUT', '/api/settings', { reminders: { time: '00:00' } });
  await server.stop();
  await server.start();
  api = await server.api();
  await expect
    .poll(async () => (await api.get<{ reminders: unknown[] }>('/api/reminders')).reminders)
    .toHaveLength(1);
  const request = await apiRequest.newContext();
  const headers = { 'X-SB-Token': api.token, Origin: server.origin };
  const zip = await request.post(`${server.origin}/api/backup/export`, { headers });
  expect(zip.status()).toBe(200);
  const parent = makeTempHome('khôi phục API');
  extraDirs.push(parent);
  const restored = await request.post(`${server.origin}/api/backup/restore`, {
    headers,
    multipart: {
      target: path.join(parent, 'Kho'),
      open: 'true',
      file: { name: 'sao lưu.zip', mimeType: 'application/zip', buffer: await zip.body() },
    },
  });
  expect(restored.status(), await restored.text()).toBe(201);
  await request.dispose();
  // The restored vault checks reminders when it opens; give that pass time to run.
  await new Promise((done) => setTimeout(done, 2_000));
  const listed = await api.get<{ reminders: { itemId: string; due: string }[] }>('/api/reminders');
  expect(listed.reminders.map((r) => `${r.itemId} ${r.due}`)).toEqual([
    `note:${project} ${isoAddDays(localIso(), 1)}`,
  ]);
});
