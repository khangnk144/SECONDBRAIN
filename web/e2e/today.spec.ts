/// <reference lib="dom" />
// Scenario S1 (daily open) in a real browser, from a fresh vault: the first-run sample-data offer,
// Today with greeting, 14-day strip, today's tasks, "Ghi nhanh" and projects; a tick that patches
// exactly one line and updates the summary at once (F9.1, F10.4); a quick thought that lands in
// Inbox with the badge counting it within 1 s (F12.3).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  appApi,
  isoAddDays,
  localIso,
  resetVault,
  treeFiles,
  type VaultTree,
} from './helpers/app-api.js';
import { e2eVaultDir } from './helpers/vault-api.js';
import { calmOnly } from './helpers/calm-only.js';

// Calm wording and layout ("…, khangnie.", the summary line): S1 in Bento is bento-today.spec.ts.
calmOnly();

test.afterEach(async ({ page }) => resetVault(await appApi(page)));

const readVaultFile = (notePath: string) =>
  readFileSync(path.join(e2eVaultDir(), ...notePath.split('/')), 'utf8');

/** SPEC F10.1 greeting table, for the machine's local time. */
function expectedGreeting(now = new Date()): string {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes >= 5 * 60 && minutes < 11 * 60) return 'Chào buổi sáng, khangnie.';
  if (minutes >= 11 * 60 && minutes < 13 * 60 + 30) return 'Chào buổi trưa, khangnie.';
  if (minutes >= 13 * 60 + 30 && minutes < 18 * 60) return 'Chào buổi chiều, khangnie.';
  if (minutes >= 18 * 60 && minutes < 23 * 60) return 'Chào buổi tối, khangnie.';
  return 'Chào khuya, khangnie.';
}

const inboxBadge = (page: Page) =>
  page
    .getByRole('treeitem', { name: /^0 Inbox/ })
    .locator('.tree-item__badge > span[aria-hidden="true"]');

test('S1: fresh vault, sample data, Today, tick a task, capture to Inbox', async ({ page }) => {
  const api = await appApi(page);
  expect((await api.get<{ offered: boolean }>('/api/sample-data')).offered).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  // First run: the calm card asks, "Tạo dữ liệu mẫu" is the default (focused) answer.
  await expect(page.getByRole('heading', { name: 'Tạo dữ liệu mẫu để xem thử?' })).toBeVisible();
  const yes = page.getByRole('button', { name: 'Tạo dữ liệu mẫu' });
  await expect(yes).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Đã tạo dữ liệu mẫu.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tạo dữ liệu mẫu để xem thử?' })).toHaveCount(0);

  // Greeting by name and time of day; one summary sentence.
  const today = localIso();
  await expect(page.locator('#today-greeting')).toHaveText(expectedGreeting());
  const summary = page.locator('.today__summary');
  await expect(summary).toHaveText(
    // Each open item counted once: the overdue one is not one of today's 2 (due today, undated).
    /Có 1 việc quá hạn\. Tuần này có \d+ deadline\. Hôm nay còn 2 việc\./,
  );
  const summaryBefore = (await summary.textContent()) ?? '';

  // The 14-day strip: today ringed, coloured dots per urgency, the overdue cell on the left.
  const strip = page.locator('.today-strip');
  await expect(strip).toHaveAttribute('data-visible-days', '14');
  const cell = (iso: string) => strip.locator(`[data-key="${iso}"]`);
  await expect(cell(today)).toHaveAttribute('aria-current', 'date');
  await expect(cell(today)).toHaveClass(/today-strip__cell--urgent/);
  await expect(cell(isoAddDays(today, 1))).toHaveClass(/today-strip__cell--urgent/);
  await expect(cell(isoAddDays(today, 5))).toHaveClass(/today-strip__cell--soon/);
  await expect(cell(isoAddDays(today, 12))).toHaveClass(/today-strip__cell--ok/);
  await expect(strip.locator('.today-strip__cell--overdue')).toContainText('Quá hạn (1)');
  const dotColor = (iso: string) =>
    cell(iso)
      .locator('.today-strip__dot')
      .evaluate((dot) => getComputedStyle(dot).backgroundColor);
  const colors = new Set([
    await dotColor(today),
    await dotColor(isoAddDays(today, 5)),
    await dotColor(isoAddDays(today, 12)),
  ]);
  expect(colors.size, 'urgent, soon and ok dots have three different colours').toBe(3);

  // "Hôm nay": the task due today, the overdue one, the undated task of today's Daily note.
  const tasks = page.getByRole('region', { name: 'Hôm nay' });
  for (const title of [
    'Gửi email hỏi thầy về đồ án',
    'Nộp bài tập Xác suất thống kê',
    'Ôn lại công thức Bayes',
  ]) {
    await expect(tasks.getByRole('checkbox', { name: title })).not.toBeChecked();
  }
  await expect(page.getByRole('region', { name: 'Ghi nhanh' }).getByRole('textbox')).toBeVisible();

  // "Đồ án đang làm": 3 of 5 tasks done = 60 %.
  const projects = page.getByRole('region', { name: 'Đồ án đang làm' });
  const progress = projects.getByRole('progressbar', { name: 'Tiến độ Đồ án Giải tích' });
  await expect(progress).toHaveAttribute('aria-valuenow', '3');
  await expect(progress).toHaveAttribute('aria-valuemax', '5');
  const fill = await progress.evaluate((bar) => {
    const inner = bar.querySelector('.project-card__fill') as HTMLElement;
    return inner.getBoundingClientRect().width / bar.getBoundingClientRect().width;
  });
  expect(fill).toBeCloseTo(0.6, 2);
  // "60%" on screen, as in the mock; "3/5 việc" is the value text and the tooltip.
  await expect(projects.locator('.project-card__count')).toHaveText('60%');
  await expect(progress).toHaveAttribute('aria-valuetext', '3/5 việc');
  await expect(projects.locator('.project-card__progress')).toHaveAttribute('title', '3/5 việc');

  // Tick on Today: only that line changes, `- [x] … ✅ <today>`; the summary follows at once.
  const dailyPath = `Daily/${today}.md`;
  const before = readVaultFile(dailyPath);
  await tasks.getByRole('checkbox', { name: 'Nộp bài tập Xác suất thống kê' }).check();
  await expect(summary).toHaveText(/Hôm nay còn 1 việc\./);
  expect(await summary.textContent()).not.toBe(summaryBefore);
  await expect.poll(() => readVaultFile(dailyPath)).not.toBe(before);
  const beforeLines = before.split('\n');
  const afterLines = readVaultFile(dailyPath).split('\n');
  expect(afterLines).toHaveLength(beforeLines.length);
  const changed = afterLines.flatMap((line, i) => (line === beforeLines[i] ? [] : [i]));
  expect(changed).toHaveLength(1);
  const old = beforeLines[changed[0]!]!;
  expect(old).toBe(`- [ ] Nộp bài tập Xác suất thống kê 📅 ${today}`);
  expect(afterLines[changed[0]!]).toBe(
    `- [x] Nộp bài tập Xác suất thống kê 📅 ${today} ✅ ${today}`,
  );

  // "Ghi nhanh" + Enter → a new note in 0 Inbox; the Inbox badge counts it within 1 s.
  await expect(inboxBadge(page)).toHaveText('2');
  const inboxBefore = treeFiles(await api.get<VaultTree>('/api/tree')).filter((f) =>
    f.path.startsWith('0 Inbox/'),
  );
  const capture = page.getByRole('region', { name: 'Ghi nhanh' }).getByRole('textbox');
  await capture.click();
  await page.keyboard.type('Hỏi thầy về tiêu chí chấm đồ án');
  const pressed = Date.now();
  await page.keyboard.press('Enter');
  await expect(inboxBadge(page)).toHaveText('3', { timeout: 5_000 });
  const badgeMs = Date.now() - pressed;
  console.log(`Ghi nhanh Enter → Inbox badge ${badgeMs} ms`);
  expect(badgeMs, 'Inbox badge within 1 s (F12.3)').toBeLessThanOrEqual(1_000);
  await expect(capture).toHaveValue('');
  await expect(capture).toBeFocused();
  const inboxAfter = treeFiles(await api.get<VaultTree>('/api/tree')).filter((f) =>
    f.path.startsWith('0 Inbox/'),
  );
  const added = inboxAfter.filter((f) => !inboxBefore.some((b) => b.path === f.path));
  expect(added.map((f) => f.path)).toEqual(['0 Inbox/Hỏi thầy về tiêu chí chấm đồ án.md']);
  const captured = readVaultFile(added[0]!.path);
  expect(captured).toMatch(/^---\ntype: note\ncreated: /);
  expect(captured).toContain('Hỏi thầy về tiêu chí chấm đồ án');
});
