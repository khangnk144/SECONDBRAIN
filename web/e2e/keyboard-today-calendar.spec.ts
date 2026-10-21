/// <reference lib="dom" />
// Keyboard-only runs (no mouse, no clicks) of the Today strip (F10.3) and the Calendar with
// rescheduling through the date picker (F11.3), on the sample data.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { appApi, createSampleData, isoAddDays, localIso, resetVault } from './helpers/app-api.js';
import { expectFocus, focusedInfo, pressUntilFocused } from './helpers/keyboard.js';
import { e2eVaultDir } from './helpers/vault-api.js';

test.beforeEach(async ({ page }) => {
  await createSampleData(await appApi(page));
});
test.afterEach(async ({ page }) => resetVault(await appApi(page)));

const readVaultFile = (notePath: string) =>
  readFileSync(path.join(e2eVaultDir(), ...notePath.split('/')), 'utf8');

test('Today strip by keyboard: Tab, arrows, Enter, tick and open, Esc (F10.3)', async ({
  page,
}) => {
  const today = localIso();
  const yesterday = isoAddDays(today, -1);
  await page.goto('/');
  await expect(page.locator('.today-strip')).toBeVisible();

  // Tab reaches the strip once, on today's cell (roving tab stop).
  await pressUntilFocused(page, '.today-strip__cell');
  expect((await focusedInfo(page)).key).toBe(today);
  await page.keyboard.press('ArrowRight');
  expect((await focusedInfo(page)).key).toBe(isoAddDays(today, 1));
  await page.keyboard.press('ArrowLeft');
  expect((await focusedInfo(page)).key).toBe(today);
  await page.keyboard.press('End');
  expect((await focusedInfo(page)).key).toBe(isoAddDays(today, 59));
  await page.keyboard.press('Home');
  await expectFocus(page, '.today-strip__cell--overdue');

  // Enter opens the overdue popover; focus lands on the first tick; Space ticks it.
  const dailyPath = `Daily/${yesterday}.md`;
  const before = readVaultFile(dailyPath);
  await page.keyboard.press('Enter');
  const popover = page.getByRole('dialog', { name: 'Quá hạn (1)' });
  await expect(popover).toBeVisible();
  await expectFocus(page, '.today-strip__popover input[type="checkbox"]');
  await page.keyboard.press('Space');
  await expect.poll(() => readVaultFile(dailyPath)).not.toBe(before);
  expect(readVaultFile(dailyPath)).toContain(
    `- [x] Gửi email hỏi thầy về đồ án 📅 ${yesterday} ✅ ${today}`,
  );
  // Esc closes it; focus goes back to the strip (the emptied overdue cell gives way to today's).
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expectFocus(page, '.today-strip__cell');

  // Tomorrow's popover: Tab from the tick to the title (the "open note" control), Enter opens the
  // project note.
  await pressUntilFocused(page, `.today-strip__cell[data-key="${isoAddDays(today, 1)}"]`, {
    key: 'ArrowRight',
    max: 5,
  });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /tháng/ })).toBeVisible();
  await expectFocus(page, '.today-strip__popover input[type="checkbox"]');
  await page.keyboard.press('Tab');
  await expectFocus(page, '.today-strip__popover .deadline-row__open');
  await expect(page.locator(':focus')).toHaveAccessibleName(/^Mở ghi chú /);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/note\?path=1%20Projects%2F/);
  await expect(page.getByRole('textbox', { name: /Tiêu đề ghi chú/ })).toHaveValue(
    'Đồ án Giải tích',
  );
});

test('Calendar by keyboard: move, change month, open a day, reschedule via the picker (F11.3)', async ({
  page,
}) => {
  const today = localIso();
  const tomorrow = isoAddDays(today, 1);
  await page.goto('/#/calendar');
  await expect(page.getByRole('grid')).toBeVisible();

  // One tab stop on the grid, on today.
  await pressUntilFocused(page, '[role="gridcell"]');
  expect((await focusedInfo(page)).key).toBe(today);
  await page.keyboard.press('ArrowDown');
  expect((await focusedInfo(page)).key).toBe(isoAddDays(today, 7));
  await page.keyboard.press('ArrowUp');
  expect((await focusedInfo(page)).key).toBe(today);
  const heading = page.getByRole('heading', { level: 1 });
  const thisMonth = (await heading.textContent()) ?? '';
  await page.keyboard.press('PageDown');
  await expect(heading).not.toHaveText(thisMonth);
  expect((await focusedInfo(page)).key.slice(0, 7)).not.toBe(today.slice(0, 7));
  await page.keyboard.press('PageUp');
  await expect(heading).toHaveText(thisMonth);
  await expect.poll(async () => (await focusedInfo(page)).key).toBe(today);

  // Tomorrow holds "Giải 10 bài tập mẫu": Enter opens the day in the right pane.
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await focusedInfo(page)).key).toBe(tomorrow);
  await page.keyboard.press('Enter');
  const pane = page.getByRole('complementary', { name: 'Ngăn bên phải' });
  await expect(pane.getByRole('checkbox', { name: 'Giải 10 bài tập mẫu' })).toBeVisible();

  // Item menu → "Dời ngày…" → picker (focus on the item's date) → two days later → Enter.
  await pressUntilFocused(page, 'button[aria-label="Thao tác với “Giải 10 bài tập mẫu”"]');
  await page.keyboard.press('Enter');
  await expectFocus(page, '[role="menuitem"]');
  expect((await focusedInfo(page)).text).toContain('Dời ngày…');
  const notePath = '1 Projects/Đồ án Giải tích.md';
  const before = readVaultFile(notePath);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Dời “Giải 10 bài tập mẫu” sang ngày' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  const moved = isoAddDays(tomorrow, 2);
  await expect.poll(() => readVaultFile(notePath)).not.toBe(before);
  const after = readVaultFile(notePath);
  expect(after).toBe(
    before.replace(
      `- [ ] Giải 10 bài tập mẫu 📅 ${tomorrow}`,
      `- [ ] Giải 10 bài tập mẫu 📅 ${moved}`,
    ),
  );
  await expect(
    page.getByRole('region', { name: 'Thông báo' }).getByRole('button', { name: 'Hoàn tác' }),
  ).toBeVisible();
  // Focus stays in the pane (the row left the day).
  await expectFocus(page, '.calendar-day-panel__title');
});

test('focus stays in the strip when the overdue cell goes away after its popover closed (F10.3)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.today-strip')).toBeVisible();
  await pressUntilFocused(page, '.today-strip__cell');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Quá hạn (1)' })).toBeVisible();
  // The tick reaches the server, but its answer is held until the popover is closed.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let reached: () => void = () => {};
  const atServer = new Promise<void>((resolve) => (reached = resolve));
  await page.route('**/api/note/task', async (route) => {
    const response = await route.fetch();
    reached();
    await held;
    await route.fulfill({ response });
  });
  await page.keyboard.press('Space');
  await atServer;
  await page.keyboard.press('Escape');
  await expectFocus(page, '.today-strip__cell--overdue');
  release();
  await expect(page.locator('.today-strip__cell--overdue')).toHaveCount(0);
  await expectFocus(page, '.today-strip__cell.is-today');
});
