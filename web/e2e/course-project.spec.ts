/// <reference lib="dom" />
// Scenario S2 except notifications (SPEC §2, §12 M3): a course project from its template with the
// caret at `{{cursor}}` (F14.2), a deadline set in the property bar reaching Today and Calendar
// within 1 s (F7.3), a dated subtask shown on both, then rescheduled in the Calendar by drag and by
// "Dời ngày…" with only the date token changing on disk and "Hoàn tác" restoring it (F11.2).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { appApi, isoAddDays, localIso, resetVault } from './helpers/app-api.js';
import { appReady, settled } from './helpers/keyboard.js';
import { e2eVaultDir } from './helpers/vault-api.js';

test.afterEach(async ({ page }) => resetVault(await appApi(page)));

const readVaultFile = (notePath: string) =>
  readFileSync(path.join(e2eVaultDir(), ...notePath.split('/')), 'utf8');
const monthOf = (iso: string) => iso.slice(0, 7);
const typedDate = (iso: string) => iso.split('-').reverse().join('/');

/** The lines of `after` that differ from `before` (same line count required). */
function changedLines(before: string, after: string): { before: string; after: string }[] {
  const a = before.split('\n');
  const b = after.split('\n');
  expect(b).toHaveLength(a.length);
  return b.flatMap((line, i) => (line === a[i] ? [] : [{ before: a[i]!, after: line }]));
}

/** Milliseconds from `since` until `check` passes (polled every 25 ms, gives up after 5 s). */
async function msUntil(since: number, check: () => Promise<boolean>): Promise<number> {
  await expect.poll(check, { intervals: [25], timeout: 5_000 }).toBe(true);
  return Date.now() - since;
}

const stripHasTitle = (page: Page, iso: string, title: string) => () =>
  page
    .locator(`.today-strip [data-key="${iso}"]`)
    .evaluate((cell, t) => cell.textContent?.includes(t) ?? false, title)
    .catch(() => false);
const calendarHasTitle = (page: Page, iso: string, title: string) => () =>
  page
    .locator(`td[data-date="${iso}"]`)
    .evaluate((cell, t) => cell.getAttribute('aria-label')?.includes(t) ?? false, title)
    .catch(() => false);

test('S2: course project → deadline and dated subtask on Today and Calendar → reschedule, undo', async ({
  page,
  context,
}) => {
  test.slow();
  const title = 'Đồ án Xác suất e2e';
  const notePath = `0 Inbox/${title}.md`;
  const today = localIso();
  const deadline = isoAddDays(today, 4);
  const due = isoAddDays(today, 2);
  // Targets in the same month as the subtask, so one calendar month shows them all.
  const sameMonth = (iso: string) => monthOf(iso) === monthOf(due) && iso !== due;
  const dragTo = [isoAddDays(due, 3), isoAddDays(due, -1)].find(sameMonth)!;
  const pickTo = [isoAddDays(due, 5), isoAddDays(due, -2)].find(
    (d) => sameMonth(d) && d !== dragTo,
  )!;

  // Alt+N → "Course project" → name it → Enter: the caret sits where the template had {{cursor}}.
  await page.goto('/#/calendar');
  await expect(page.getByRole('grid')).toBeVisible();
  await appReady(page);
  await page.keyboard.press('Alt+n');
  const picker = page.getByRole('listbox');
  await expect(picker).toBeFocused();
  await picker.getByRole('option', { name: /Course project/ }).click();
  const noteTitle = page.getByRole('textbox', { name: /Tiêu đề ghi chú/ });
  await expect(noteTitle).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  const body = page.getByRole('textbox', { name: /Nội dung ghi chú/ });
  await expect(body).toBeFocused();
  await page.keyboard.type('Viết báo cáo 10 trang');
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => readVaultFile(notePath)).toContain('Viết báo cáo 10 trang');
  const created = readVaultFile(notePath);
  expect(created).toContain('## Yêu cầu\n\nViết báo cáo 10 trang\n');
  expect(created).not.toContain('{{cursor}}');
  expect(created).toMatch(/^---\ntype: project\nstatus: todo\ndeadline:\n/);

  // Today and Calendar are open in two more tabs, live.
  const todayPage = await context.newPage();
  await todayPage.goto('/');
  await expect(todayPage.locator('.today-strip')).toBeVisible();
  const calendarPage = await context.newPage();
  // Tall enough for the whole month: Playwright's HTML5 drag cannot scroll to a drop target
  // below the fold, and Bento's day cells are taller than calm's.
  await calendarPage.setViewportSize({ width: 1280, height: 1000 });
  await calendarPage.goto(`/#/calendar?month=${monthOf(deadline)}`);
  await expect(calendarPage.locator(`td[data-date="${deadline}"]`)).toBeVisible();

  // Deadline from the property bar: on the strip and in the calendar within 1 s.
  await page.bringToFront();
  await page.locator('.property-chip[data-key="deadline"] .property-chip__main').click();
  const dateInput = page.getByRole('dialog', { name: 'Sửa Hạn chót' }).getByLabel('Hạn chót');
  await dateInput.fill(deadline);
  const patched = page.waitForResponse(
    (r) => r.url().includes('/api/note/frontmatter') && r.request().method() === 'PATCH',
  );
  await dateInput.press('Enter');
  expect((await patched).status()).toBe(200);
  const t0 = Date.now();
  const stripMs = await msUntil(t0, stripHasTitle(todayPage, deadline, title));
  const calendarMs = await msUntil(t0, calendarHasTitle(calendarPage, deadline, title));
  console.log(`deadline → strip ${stripMs} ms, calendar ${calendarMs} ms`);
  expect(stripMs, 'deadline on the Today strip within 1 s (F7.3)').toBeLessThanOrEqual(1_000);
  expect(calendarMs, 'deadline in the calendar within 1 s (F7.3)').toBeLessThanOrEqual(1_000);
  expect(readVaultFile(notePath)).toContain(`\ndeadline: ${deadline}\n`);

  // A dated subtask typed with 📅: it shows on both too.
  await body.getByText('Viết báo cáo 10 trang').click();
  await page.keyboard.press('End');
  await settled(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type(`- [ ] Nộp bản nháp 📅 ${due}`);
  await page.keyboard.press('Enter'); // the date popup takes the typed date
  const taskLine = `- [ ] Nộp bản nháp 📅 ${due}`;
  await expect.poll(() => readVaultFile(notePath), { timeout: 10_000 }).toContain(taskLine);
  if (monthOf(due) !== monthOf(deadline)) {
    await calendarPage.goto(`/#/calendar?month=${monthOf(due)}`);
  }
  await expect.poll(stripHasTitle(todayPage, due, 'Nộp bản nháp')).toBe(true);
  await expect.poll(calendarHasTitle(calendarPage, due, 'Nộp bản nháp')).toBe(true);

  // Reschedule by drag in the calendar: only the date token changes; "Hoàn tác" restores it.
  await calendarPage.bringToFront();
  const beforeDrag = readVaultFile(notePath);
  const item = calendarPage.locator(`td[data-date="${due}"] .calendar-item`, {
    hasText: 'Nộp bản nháp',
  });
  await item.dragTo(calendarPage.locator(`td[data-date="${dragTo}"]`));
  await expect.poll(() => readVaultFile(notePath)).not.toBe(beforeDrag);
  expect(changedLines(beforeDrag, readVaultFile(notePath))).toEqual([
    { before: taskLine, after: `- [ ] Nộp bản nháp 📅 ${dragTo}` },
  ]);
  await expect.poll(calendarHasTitle(calendarPage, dragTo, 'Nộp bản nháp')).toBe(true);
  await calendarPage
    .getByRole('region', { name: 'Thông báo' })
    .getByRole('button', { name: 'Hoàn tác' })
    .click();
  await expect.poll(() => readVaultFile(notePath)).toBe(beforeDrag);
  await expect.poll(calendarHasTitle(calendarPage, due, 'Nộp bản nháp')).toBe(true);

  // Once more with "Dời ngày…" from the day pane's item menu and the date picker.
  await calendarPage.locator(`td[data-date="${due}"]`).click();
  const pane = calendarPage.getByRole('complementary', { name: 'Ngăn bên phải' });
  await pane.getByRole('button', { name: 'Thao tác với “Nộp bản nháp”' }).click();
  await calendarPage.getByRole('menuitem', { name: 'Dời ngày…' }).click();
  const dialog = calendarPage.getByRole('dialog', { name: 'Dời “Nộp bản nháp” sang ngày' });
  await dialog.getByLabel('Hoặc gõ ngày (dd/mm/yyyy)').fill(typedDate(pickTo));
  await dialog.getByRole('button', { name: 'Dời ngày', exact: true }).click();
  await expect.poll(() => readVaultFile(notePath)).not.toBe(beforeDrag);
  expect(changedLines(beforeDrag, readVaultFile(notePath))).toEqual([
    { before: taskLine, after: `- [ ] Nộp bản nháp 📅 ${pickTo}` },
  ]);
  await calendarPage
    .getByRole('region', { name: 'Thông báo' })
    .getByRole('button', { name: 'Hoàn tác' })
    .click();
  await expect.poll(() => readVaultFile(notePath)).toBe(beforeDrag);
});
