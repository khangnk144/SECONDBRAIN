/// <reference lib="dom" />
// Scenario S6, round trip of trust, minus the reboot (SPEC §2, §5 data safety): on a fresh home,
// write a note, drop a document, set a deadline and tick a task, see the deadline on Today and in
// the Calendar; type a few more words and kill the server (SIGKILL) before it confirmed them;
// start it again on the same home → after a reload the draft banner brings the last words back,
// and the document, deadline and tick are there; then a graceful stop/start keeps everything and
// the vault's git history has the shutdown commit with the last words.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { isoAddDays, localIso } from './helpers/app-api.js';
import { dropFiles, multiPagePdf } from './helpers/file-fixtures.js';
import { appReady } from './helpers/keyboard.js';
import { caretToEnd, newLastLine, noteBody, noteHash, noteTitle } from './helpers/note-page.js';
import { ownServer, UTF8_BROWSER, type OwnServer } from './helpers/own-server.js';
import { shot } from './helpers/screenshots.js';

test.use(UTF8_BROWSER);

let server: OwnServer;
test.beforeEach(async () => {
  server = ownServer(47695);
  await server.start();
});
test.afterEach(async () => server.dispose());

const title = 'Chuyến đi tin cậy';
const notePath = `0 Inbox/${title}.md`;
const pdfName = 'đề bài đồ án.pdf';
const readNote = () => readFileSync(path.join(server.vaultDir, ...notePath.split('/')), 'utf8');

function gitInVault(...args: string[]): string {
  return execFileSync('git', ['-C', server.vaultDir, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: path.join(server.home, 'os-home'),
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
}
const gitPresent = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** The unsaved text of this note in the browser's draft store (IndexedDB), or null. */
const draftText = (page: Page) =>
  page.evaluate(
    (wanted) =>
      new Promise<string | null>((resolve) => {
        const open = indexedDB.open('second-brain-drafts');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('drafts')) return resolve(null);
          const all = db.transaction('drafts').objectStore('drafts').getAll();
          all.onsuccess = () => {
            const rows = all.result as { path?: string; text?: string }[];
            resolve(rows.find((row) => row.path === wanted)?.text ?? null);
            db.close();
          };
          all.onerror = () => resolve(null);
        };
      }),
    notePath,
  );

const stripHas = (page: Page, iso: string) =>
  expect(page.locator(`.today-strip [data-key="${iso}"]`)).toContainText(title);

test('S6: write, attach, deadline, tick → kill mid-typing → restart keeps every word (F20, §5)', async ({
  page: firstWindow,
  context,
}) => {
  let page = firstWindow;
  test.slow();
  const deadline = isoAddDays(localIso(), 4);

  // Write a note from the course-project template and wait until the server has it.
  await page.goto(`${server.origin}/`);
  await appReady(page);
  await page.keyboard.press('Alt+n');
  await page
    .getByRole('listbox')
    .getByRole('option', { name: /Course project/ })
    .click();
  await expect(noteTitle(page)).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(noteBody(page)).toBeFocused();
  await page.keyboard.type('Báo cáo về chuyến đi thực tế.');
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Attach the assignment PDF, set the deadline, tick the first task.
  await dropFiles(await newLastLine(page), [
    { name: pdfName, type: 'application/pdf', bytes: multiPagePdf(['De bai do an']) },
  ]);
  await page
    .getByRole('dialog', { name: 'Lưu vào' })
    .getByRole('button', { name: 'Lưu', exact: true })
    .click();
  const pdfFile = path.join(server.vaultDir, '3 Resources', 'papers', pdfName);
  await expect.poll(() => existsSync(pdfFile)).toBe(true);
  await expect.poll(readNote).toContain(`[[${pdfName}]]`);
  await page.locator('.property-chip[data-key="deadline"] .property-chip__main').click();
  const dateInput = page.getByRole('dialog', { name: 'Sửa Hạn chót' }).getByLabel('Hạn chót');
  await dateInput.fill(deadline);
  await dateInput.press('Enter');
  await expect.poll(readNote).toContain(`\ndeadline: ${deadline}\n`);
  await noteBody(page).getByRole('checkbox').first().check();
  await expect.poll(readNote).toContain('- [x] Đọc kỹ đề bài và tiêu chí chấm điểm');

  // The same deadline on Today and in the Calendar.
  await page.goto(`${server.origin}/`);
  await stripHas(page, deadline);
  await page.goto(`${server.origin}/#/calendar?month=${deadline.slice(0, 7)}`);
  await expect(page.locator(`td[data-date="${deadline}"]`)).toHaveAttribute(
    'aria-label',
    new RegExp(title),
  );

  // A few more words; the server never confirms them (saves are held), then it is killed and
  // the window closed. (A window left open would simply save them once the server is back.)
  await page.goto(`${server.origin}/${noteHash(notePath)}`);
  await expect(noteBody(page)).toContainText('Báo cáo về chuyến đi thực tế.');
  await page.route(`${server.origin}/api/note`, (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    // Held: no answer until the server is gone.
  });
  const lastWords = 'Những chữ cuối cùng trước khi tắt';
  await caretToEnd(page);
  await page.keyboard.type(` ${lastWords}`);
  await expect.poll(() => draftText(page)).toContain(lastWords);
  expect(readNote()).not.toContain(lastWords);
  await server.kill();
  await page.close();

  // Same home, new server, a new window: the draft comes back with a banner and is saved.
  await server.start();
  page = await context.newPage();
  await page.goto(`${server.origin}/${noteHash(notePath)}`);
  await expect(noteTitle(page)).toHaveValue(title);
  await expect(page.getByText('Đã khôi phục bản nháp chưa lưu.')).toBeVisible();
  await expect(noteBody(page)).toContainText(lastWords);
  await shot(page, 'round-trip-draft-restored');
  await expect.poll(readNote, { timeout: 10_000 }).toContain(lastWords);
  await expect(noteBody(page).locator('.wikilink', { hasText: pdfName })).toBeVisible();
  await expect(noteBody(page).getByRole('checkbox').first()).toBeChecked();

  // Graceful stop and start, then a fresh load: everything is still there, on disk and on
  // screen, and the saved draft is gone (no banner, no conflict).
  await server.stop();
  await server.start();
  await page.reload();
  await expect(noteBody(page)).toContainText(lastWords);
  await expect(page.getByText('Đã khôi phục bản nháp chưa lưu.')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await draftText(page)).toBeNull();
  const final = readNote();
  expect(final).toContain(`deadline: ${deadline}`);
  expect(final).toContain('- [x] Đọc kỹ đề bài và tiêu chí chấm điểm');
  expect(final).toContain(`[[${pdfName}]]`);
  expect(existsSync(pdfFile)).toBe(true);
  await page.goto(`${server.origin}/`);
  await stripHas(page, deadline);

  // History: the graceful stop committed the last words (auto commit on shutdown).
  if (gitPresent) {
    const subjects = gitInVault('log', '--format=%s').trim().split('\n');
    expect(subjects[0]).toMatch(/^auto: \d+ files$/);
    expect(gitInVault('show', `HEAD:${notePath}`)).toContain(lastWords);
  }
});
