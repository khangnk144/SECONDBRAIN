/// <reference lib="dom" />
// Keyboard-only runs (no mouse, no clicks) of the search and command palette (F8.2–F8.4, Ctrl+Enter
// for a new tab) and of quick capture from Today, the editor and the calendar with focus and caret
// coming back (F12.1).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  appApi,
  createSampleData,
  isoAddDays,
  localIso,
  resetVault,
  treeFiles,
  type AppApi,
  type VaultTree,
} from './helpers/app-api.js';
import {
  appReady,
  expectFocus,
  focusedInfo,
  pressUntilFocused,
  settled,
} from './helpers/keyboard.js';
import { e2eVaultDir } from './helpers/vault-api.js';

test.beforeEach(async ({ page }) => {
  await createSampleData(await appApi(page));
});
test.afterEach(async ({ page }) => resetVault(await appApi(page)));

const readVaultFile = (notePath: string) =>
  readFileSync(path.join(e2eVaultDir(), ...notePath.split('/')), 'utf8');
const paletteInput = (page: Page) => page.getByRole('combobox', { name: 'Tìm ghi chú' });
const activeOption = (page: Page) =>
  page.locator('.palette-option[aria-selected="true"] .palette-option__title');
const optionTitles = (page: Page) => page.locator('.palette-option .palette-option__title');

/** ↓ until the active option's title is exactly `title`. */
async function arrowTo(page: Page, title: string): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    if ((await activeOption(page).textContent())?.trim() === title) return;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`no option "${title}"; options: ${await optionTitles(page).allTextContents()}`);
}

/** Types a search query and waits until the server answered exactly that query. */
async function typeSearch(page: Page, text: string): Promise<void> {
  const answered = page.waitForResponse(
    (r) => r.url().includes('/api/search') && new URL(r.url()).searchParams.get('q') === text,
  );
  await page.keyboard.type(text);
  await answered;
}

async function inboxPaths(api: AppApi): Promise<string[]> {
  return treeFiles(await api.get<VaultTree>('/api/tree'))
    .map((file) => file.path)
    .filter((p) => p.startsWith('0 Inbox/'));
}

test('palette by keyboard: diacritic-free search, commands, filters, Ctrl+Enter (F8)', async ({
  page,
}) => {
  const api = await appApi(page);
  const today = localIso();
  // Filter fixture: only notes tagged đồ-án with an open item due within 7 days may come back.
  const note = (fm: string[]) => ['---', ...fm, '---', '', 'Nội dung.', ''].join('\n');
  const notes: Record<string, string> = {
    '1 Projects/Đồ án gần e2e.md': note(['tags: [đồ-án]', `deadline: ${isoAddDays(today, 3)}`]),
    '1 Projects/Đồ án xa e2e.md': note(['tags: [đồ-án]', `deadline: ${isoAddDays(today, 20)}`]),
    '1 Projects/Đồ án xong e2e.md': note([
      'tags: [đồ-án]',
      'status: done',
      `deadline: ${isoAddDays(today, 2)}`,
    ]),
    '1 Projects/Bài tập gần e2e.md': note([`deadline: ${isoAddDays(today, 2)}`]),
    '4 Archive/Đồ án cũ e2e.md': note(['tags: [đồ-án]', `deadline: ${isoAddDays(today, 3)}`]),
  };
  for (const [notePath, content] of Object.entries(notes)) {
    await api.send('POST', '/api/note', { path: notePath, content });
  }
  await page.goto('/');
  await expect(page.locator('.today-strip')).toBeVisible();
  await appReady(page);

  // Ctrl+K, `giai tich` (no diacritics) → "Giải tích 1" → Enter opens it.
  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeFocused();
  await typeSearch(page, 'giai tich');
  await arrowTo(page, 'Giải tích 1');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/path=2%20Areas%2FGi/);
  await expect(page.getByRole('textbox', { name: /Tiêu đề ghi chú/ })).toHaveValue('Giải tích 1');

  // `>` lists commands; "Mở Lịch" runs from the keyboard.
  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeFocused();
  await page.keyboard.type('>lịch');
  await arrowTo(page, 'Mở Lịch');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/calendar/);

  // `tag:đồ-án due:7d`: only tagged notes with an open item within 7 days; archive excluded.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('tag:đồ-án due:7d');
  await expect(page.getByRole('status').filter({ hasText: /kết quả/ })).toHaveText('2 kết quả', {
    timeout: 10_000,
  });
  expect((await optionTitles(page).allTextContents()).sort()).toEqual(
    ['Đồ án Giải tích', 'Đồ án gần e2e'].sort(),
  );
  await page.keyboard.type(' class:archive');
  await expect(page.getByRole('status').filter({ hasText: /kết quả/ })).toHaveText('3 kết quả');
  expect((await optionTitles(page).allTextContents()).sort()).toEqual(
    ['Đồ án Giải tích', 'Đồ án cũ e2e', 'Đồ án gần e2e'].sort(),
  );
  await page.keyboard.press('Escape');
  await expect(paletteInput(page)).toHaveCount(0);

  // Ctrl+Enter opens in a new tab: two note tabs, the first one kept.
  await page.keyboard.press('Control+k');
  await typeSearch(page, 'xac suat thong ke');
  await arrowTo(page, 'Xác suất thống kê');
  await page.keyboard.press('Control+Enter');
  const tabs = page.getByRole('navigation', { name: 'Thẻ ghi chú đang mở' }).locator('.tab');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).toContainText('Giải tích 1');
  await expect(tabs.nth(1)).toContainText('Xác suất thống kê');
});

test('quick capture by keyboard from Today, the editor and the calendar; focus comes back (F12.1)', async ({
  page,
}) => {
  const api = await appApi(page);
  const capture = page.getByRole('dialog', { name: 'Ghi nhanh vào Inbox' });

  /** Alt+Q, type, Enter: 3 key actions; returns the new Inbox path. */
  async function captureFromHere(text: string): Promise<string> {
    const before = await inboxPaths(api);
    await page.keyboard.press('Alt+q');
    await expect(capture).toBeVisible();
    await expectFocus(page, '.capture-box__input');
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await expect(capture).toHaveCount(0);
    await expect.poll(async () => (await inboxPaths(api)).length).toBe(before.length + 1);
    const added = (await inboxPaths(api)).filter((p) => !before.includes(p));
    expect(readVaultFile(added[0]!)).toContain(text);
    return added[0]!;
  }

  // From Today, with focus on a strip cell.
  await page.goto('/');
  await expect(page.locator('.today-strip')).toBeVisible();
  await pressUntilFocused(page, '.today-strip__cell');
  const cellKey = (await focusedInfo(page)).key;
  expect(await captureFromHere('Ghi từ Hôm nay')).toBe('0 Inbox/Ghi từ Hôm nay.md');
  await expect(page.getByText('Đã lưu vào Inbox.')).toBeVisible();
  await expectFocus(page, `.today-strip__cell[data-key="${cellKey}"]`);

  // From the editor with the caret in the middle of a paragraph: the caret is back in place.
  const notePath = '2 Areas/Xác suất thống kê.md';
  await page.goto(`/#/note?path=${encodeURIComponent(notePath)}`);
  const body = page.getByRole('textbox', { name: /Nội dung ghi chú/ });
  await expect(body).toContainText('Học thứ Ba');
  await pressUntilFocused(page, '.ProseMirror');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight'); // after "Học "
  await settled(page);
  const caret = () =>
    page.evaluate(() => {
      const selection = document.getSelection();
      return { text: selection?.anchorNode?.textContent ?? '', offset: selection?.anchorOffset };
    });
  const caretBefore = await caret();
  expect(caretBefore.text.slice(0, caretBefore.offset)).toBe('Học ');
  await captureFromHere('Ghi từ trình soạn thảo');
  await expectFocus(page, '.ProseMirror');
  expect(await caret()).toEqual(caretBefore);
  await page.keyboard.type('X');
  await expect.poll(() => readVaultFile(notePath)).toContain('Học Xthứ Ba');

  // From the calendar grid: focus returns to the same day.
  await page.goto('/#/calendar');
  await expect(page.getByRole('grid')).toBeVisible();
  await pressUntilFocused(page, '[role="gridcell"]');
  await page.keyboard.press('ArrowRight');
  const day = (await focusedInfo(page)).key;
  await captureFromHere('Ghi từ Lịch');
  await expectFocus(page, `[role="gridcell"][data-date="${day}"]`);
});
