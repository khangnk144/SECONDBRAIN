/// <reference lib="dom" />
// Both languages (SPEC F19.2): S1 (sample data, a tick on Today, a quick capture into Inbox) and
// S3a (a lecture with a [[ link, seen in the course's backlinks) run in Vietnamese, the language
// is switched in Settings without a reload, then both run again in English. After the switch no
// Vietnamese UI string is left on Settings, Today, the sidebar or the note screen's chrome (every
// vi.json string English says differently is looked for; what she wrote is left out). Own server:
// the language is a global setting.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { appReady } from './helpers/keyboard.js';
import { tr, vietnameseLeftovers, type Lang } from './helpers/locale-strings.js';
import { caretToEnd, noteHash } from './helpers/note-page.js';
import { ownServer, type OwnServer } from './helpers/own-server.js';
import { shot } from './helpers/screenshots.js';

let server: OwnServer;
test.beforeEach(async () => {
  server = ownServer(47694);
  await server.start();
});
test.afterEach(async () => server.dispose());

const course = '2 Areas/Giải tích 1.md';
const inVault = (notePath: string) => path.join(server.vaultDir, ...notePath.split('/'));

/** S1 on Today: tick `task`, capture `thought` into Inbox. */
async function dailyOpen(page: Page, lang: Lang, task: string, thought: string) {
  const tasks = page.getByRole('region', { name: tr(lang, 'today.tasks.title'), exact: true });
  await tasks.getByRole('checkbox', { name: task }).check();
  await expect(tasks.getByRole('checkbox', { name: task })).toBeChecked();
  const capture = page
    .getByRole('region', { name: tr(lang, 'today.capture.title') })
    .getByRole('textbox');
  await capture.click();
  await page.keyboard.type(thought);
  await page.keyboard.press('Enter');
  await expect(capture).toHaveValue('');
  await expect.poll(() => existsSync(inVault(`0 Inbox/${thought}.md`))).toBe(true);
  // The box keeps focus for the next thought; app shortcuts such as Alt+N wait outside it.
  await capture.blur();
}

/** S3a: a lecture from its template linking the course, then the course's backlinks. */
async function lectureWithLink(page: Page, lang: Lang, title: string, words: string) {
  await page.keyboard.press('Alt+n');
  await page
    .getByRole('listbox')
    .getByRole('option', { name: /Lecture/ })
    .click();
  const titleBox = page.getByRole('textbox', { name: tr(lang, 'note.title.label') });
  await expect(titleBox).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  const body = page.getByRole('textbox', { name: tr(lang, 'note.editorLabel', { title }) });
  await expect(body).toBeFocused();
  await caretToEnd(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type(`${words} [[giai tich`);
  await expect(page.getByRole('option', { name: /^Giải tích 1/ }).first()).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Enter');
  await expect(page.getByText(tr(lang, 'note.save.saved'), { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await page.goto(`${server.origin}/${noteHash(course)}`);
  const pane = page.getByRole('complementary', { name: tr(lang, 'panel.label') });
  const backlinks = pane.getByRole('region', {
    name: new RegExp(`^${tr(lang, 'backlinks.linked.title')}`),
  });
  await expect(backlinks.getByRole('button', { name: new RegExp(title) })).toBeVisible({
    timeout: 10_000,
  });
}

test('S1 and S3a in Vietnamese, then in English after a live switch with no Vietnamese left (F19.2)', async ({
  page,
}) => {
  test.slow();
  await page.goto(`${server.origin}/`);
  await appReady(page);
  await page.getByRole('button', { name: tr('vi', 'today.sample.create') }).click();
  await expect(page.getByText(tr('vi', 'today.sample.created'))).toBeVisible();

  // Vietnamese.
  await dailyOpen(page, 'vi', 'Nộp bài tập Xác suất thống kê', 'Ý tưởng bằng tiếng Việt');
  await lectureWithLink(page, 'vi', 'Bài giảng tiếng Việt', 'Đạo hàm của hàm hợp, xem');

  // The switch, in this same document.
  await page.evaluate(() => ((window as unknown as { __same: boolean }).__same = true));
  await page.keyboard.press('Alt+,');
  await expect(
    page.getByRole('heading', { level: 1, name: tr('vi', 'settings.title') }),
  ).toBeVisible();
  // The detector itself: in Vietnamese it sees the screen's strings.
  await expect.poll(async () => (await vietnameseLeftovers(page)).length).toBeGreaterThan(30);
  await page.getByRole('radio', { name: 'English' }).check();
  await expect(
    page.getByRole('heading', { level: 1, name: tr('en', 'settings.title') }),
  ).toBeVisible();
  await expect.poll(() => vietnameseLeftovers(page), { message: 'Settings' }).toEqual([]);
  await shot(page, 'languages-settings-en');

  const nav = page.getByRole('navigation', { name: tr('en', 'nav.label') });
  await nav.getByRole('link', { name: tr('en', 'nav.today') }).click();
  await expect(
    page.getByRole('region', { name: tr('en', 'today.tasks.title'), exact: true }),
  ).toBeVisible();
  // Task, project and capture texts are hers (Vietnamese sample data), not UI.
  const content = [
    '.deadline-row__title',
    '.deadline-row__note',
    '.today-strip__label',
    '.project-card__title',
  ];
  await expect
    .poll(() => vietnameseLeftovers(page, content), { message: 'Today and sidebar' })
    .toEqual([]);
  await shot(page, 'languages-today-en');

  await page.goto(`${server.origin}/${noteHash(course)}`);
  await expect(page.getByRole('textbox', { name: tr('en', 'note.title.label') })).toHaveValue(
    'Giải tích 1',
  );
  await expect.poll(() => vietnameseLeftovers(page), { message: 'note screen' }).toEqual([]);
  await shot(page, 'languages-note-en');
  expect(
    await page.evaluate(() => (window as unknown as { __same?: boolean }).__same === true),
  ).toBe(true);

  // English.
  await nav.getByRole('link', { name: tr('en', 'nav.today') }).click();
  await dailyOpen(page, 'en', 'Ôn lại công thức Bayes', 'An idea in English');
  await lectureWithLink(page, 'en', 'English lecture', 'Chain rule, see');
  expect(
    await page.evaluate(() => (window as unknown as { __same?: boolean }).__same === true),
  ).toBe(true);
});
