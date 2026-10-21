/// <reference lib="dom" />
// Version history in the app (SPEC F20.3, with git on PATH): the server commits on a graceful
// stop, so two restarts give a note two versions; "Lịch sử phiên bản" (palette) shows them with
// a diff, "Khôi phục phiên bản này" brings the old text back into the editor and commits it; a
// restore against a note that changed meanwhile (edited through the API) is refused with the 409
// message and the newer text stays. Own server: restarts and git in its own vault.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { AppApi } from './helpers/app-api.js';
import { appReady } from './helpers/keyboard.js';
import { noteBody, noteHash, noteTitle } from './helpers/note-page.js';
import { ownServer, type OwnServer } from './helpers/own-server.js';
import { shot } from './helpers/screenshots.js';

const gitPresent = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
test.skip(!gitPresent, 'version history needs git on PATH');

let server: OwnServer;
test.beforeEach(async () => {
  server = ownServer(47697);
  await server.start();
});
test.afterEach(async () => server.dispose());

const notePath = '1 Projects/Nhật ký đồ án.md';
const v1 = '# Nhật ký đồ án\n\nBản đầu: chọn đề tài.\n';
const v2 = '# Nhật ký đồ án\n\nBản hai: đã gặp thầy hướng dẫn.\n';
const onDisk = () => readFileSync(path.join(server.vaultDir, ...notePath.split('/')), 'utf8');
const gitLog = () =>
  execFileSync('git', ['-C', server.vaultDir, 'log', '--format=%s'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: path.join(server.home, 'os-home') },
  });

async function readNote(api: AppApi) {
  return api.get<{ content: string; revision: string }>(
    `/api/note?path=${encodeURIComponent(notePath)}`,
  );
}

/** A graceful restart: the history plugin commits pending changes when the server stops. */
async function restart(): Promise<AppApi> {
  await server.stop();
  await server.start();
  return server.api();
}

test('history lists versions with a diff, restores one, refuses a stale restore (F20.3)', async ({
  page,
}) => {
  test.slow();
  let api = await server.api();
  await api.send('POST', '/api/note', { path: notePath, content: v1 });
  api = await restart();
  const first = await readNote(api);
  await api.send('PUT', '/api/note', {
    path: notePath,
    content: v2,
    expectedRevision: first.revision,
  });
  api = await restart();
  const versions = await api.get<{ available: boolean; commits: { message: string }[] }>(
    `/api/history?path=${encodeURIComponent(notePath)}`,
  );
  expect(versions.available).toBe(true);
  expect(versions.commits.length).toBe(2);

  // Palette → "Xem lịch sử phiên bản": two versions, the older one differs from the note.
  await page.goto(`${server.origin}/${noteHash(notePath)}`);
  await appReady(page);
  await expect(noteBody(page)).toContainText('Bản hai: đã gặp thầy hướng dẫn.');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('lịch sử phiên bản');
  await page.locator('.palette-option', { hasText: 'Xem lịch sử phiên bản' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Lịch sử phiên bản' });
  const list = dialog.getByRole('list', { name: 'Các phiên bản, mới nhất trước' });
  await expect(list.getByRole('button')).toHaveCount(2);
  await list.getByRole('button').nth(1).click();
  const diff = dialog.getByRole('list', { name: 'Khác biệt giữa bản hiện tại và bản đã chọn' });
  await expect(diff).toContainText('Bản đầu: chọn đề tài.');
  await expect(diff).toContainText('Bản hai: đã gặp thầy hướng dẫn.');
  await expect(dialog).toContainText('Nếu khôi phục: 1 dòng trở lại (+), 1 dòng mất đi (−).');
  await shot(page, 'history-diff');

  // Restore it: the editor shows the old text, the disk has it, history has a restore commit.
  await dialog.getByRole('button', { name: 'Khôi phục phiên bản này' }).click();
  await dialog.getByRole('button', { name: 'Khôi phục', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Đã khôi phục phiên bản cũ của Nhật ký đồ án.')).toBeVisible();
  await expect(noteBody(page)).toContainText('Bản đầu: chọn đề tài.');
  await expect(noteBody(page)).not.toContainText('Bản hai');
  expect(onDisk()).toBe(v1);
  expect(gitLog().split('\n')[0]).toMatch(
    /^restore: 1 Projects\/Nhật ký đồ án\.md @ [0-9a-f]{7,}$/,
  );

  // From the right pane this time: pick the newer version, then the note changes meanwhile.
  const pane = page.getByRole('complementary', { name: 'Ngăn bên phải' });
  const section = pane.getByRole('button', { name: 'Lịch sử', exact: true });
  await expect(section).toHaveAttribute('aria-expanded', 'false');
  await section.click();
  await pane.getByRole('button', { name: 'Xem tất cả' }).click();
  await expect(list.getByRole('button')).toHaveCount(3);
  await list.getByRole('button').nth(1).click();
  await expect(dialog).toContainText('Bản hai: đã gặp thầy hướng dẫn.');
  const current = await readNote(api);
  const v3 = `${current.content}\nBản ba: viết ở cửa sổ khác.\n`;
  await api.send('PUT', '/api/note', {
    path: notePath,
    content: v3,
    expectedRevision: current.revision,
  });
  await dialog.getByRole('button', { name: 'Khôi phục phiên bản này' }).click();
  const restored = page.waitForResponse((r) => r.url().includes('/api/history/restore'));
  await dialog.getByRole('button', { name: 'Khôi phục', exact: true }).click();
  expect((await restored).status()).toBe(409);
  await expect(
    page.getByText('Ghi chú vừa thay đổi. Mở lại lịch sử để xem bản mới nhất.'),
  ).toBeVisible();
  expect(onDisk()).toBe(v3);
  await expect(noteTitle(page)).toHaveValue('Nhật ký đồ án');
  await expect(noteBody(page)).toContainText('Bản ba: viết ở cửa sổ khác.');
});
