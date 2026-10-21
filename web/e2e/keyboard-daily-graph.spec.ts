/// <reference lib="dom" />
// Keyboard-only runs (no mouse, no clicks) of daily notes (F13.1–F13.3: Alt+T creates once, GET
// never creates, previous/next skip gaps or offer to create) and of the brain map's side panel
// (F16.4: find a node, read its neighbours, open it without touching the canvas).
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  appApi,
  createSampleData,
  isoAddDays,
  localIso,
  resetVault,
  treeFiles,
  type VaultTree,
} from './helpers/app-api.js';
import { appReady, cursorSettled, expectFocus, pressUntilFocused } from './helpers/keyboard.js';
import { e2eVaultDir } from './helpers/vault-api.js';

test.afterEach(async ({ page }) => resetVault(await appApi(page)));

const vaultFile = (notePath: string) => path.join(e2eVaultDir(), ...notePath.split('/'));
const dailyUrl = (date: string) => new RegExp(`path=Daily%2F${date}\\.md`);

test('daily notes by keyboard: Alt+T once, GET never creates, previous/next (F13)', async ({
  page,
}) => {
  const api = await appApi(page);
  const today = localIso();
  const earlier = isoAddDays(today, -3);
  const later = isoAddDays(today, 2);
  for (const date of [earlier, later]) {
    await api.send('POST', '/api/note', {
      path: `Daily/${date}.md`,
      content: `---\ntype: daily\ncreated: ${date}\n---\n\n## Ghi lại\n`,
    });
  }
  const dailyFiles = async () =>
    treeFiles(await api.get<VaultTree>('/api/tree'))
      .map((file) => file.path)
      .filter((p) => p.startsWith('Daily/'))
      .sort();

  // GET for a missing date answers 404 and creates nothing (twice, to be sure).
  for (let i = 0; i < 2; i += 1) {
    expect(await api.status(`/api/daily?date=${today}`)).toBe(404);
  }
  expect(existsSync(vaultFile(`Daily/${today}.md`))).toBe(false);
  expect(await dailyFiles()).toEqual([`Daily/${earlier}.md`, `Daily/${later}.md`]);

  // Alt+T creates today's note from the template (variables filled in Vietnamese) and opens it.
  await page.goto('/');
  await appReady(page);
  await page.keyboard.press('Alt+t');
  await expect(page).toHaveURL(dailyUrl(today));
  await cursorSettled(page);
  await expect.poll(() => existsSync(vaultFile(`Daily/${today}.md`))).toBe(true);
  const created = readFileSync(vaultFile(`Daily/${today}.md`), 'utf8');
  expect(created).not.toContain('{{');
  // dayjs gives the weekday in lower case ("# thứ ba, 20 tháng 10 2026"), so case is not checked.
  expect(created).toMatch(
    /^# (thứ (hai|ba|tư|năm|sáu|bảy)|chủ nhật), \d{1,2} tháng \d{1,2} \d{4}$/im,
  );
  expect(created).toContain(`[[${isoAddDays(today, -1)}]]`);
  expect(created).toContain(`[[${isoAddDays(today, 1)}]]`);
  const mtime = statSync(vaultFile(`Daily/${today}.md`)).mtimeMs;

  // A second Alt+T (from Today again) only opens it.
  await page.goto('/');
  await appReady(page);
  await page.keyboard.press('Alt+t');
  await expect(page).toHaveURL(dailyUrl(today));
  await expect(page.locator('.daily-nav')).toBeVisible();
  expect(readFileSync(vaultFile(`Daily/${today}.md`), 'utf8')).toBe(created);
  expect(statSync(vaultFile(`Daily/${today}.md`)).mtimeMs).toBe(mtime);
  expect(await dailyFiles()).toEqual([
    `Daily/${earlier}.md`,
    `Daily/${today}.md`,
    `Daily/${later}.md`,
  ]);

  // "Ngày sau" skips the missing day; from there the next day is offered for creation.
  await pressUntilFocused(page, '.daily-nav__step--next');
  await expect(page.locator('.daily-nav__step--next')).toHaveText('Ngày sau');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(dailyUrl(later));
  const tomorrowOfLater = isoAddDays(later, 1).slice(5).split('-').reverse().join('/');
  await expect(page.locator('.daily-nav__step--next')).toHaveText(`Tạo ngày ${tomorrowOfLater}`);

  // "Ngày trước" from `later` skips back over the gap to today, then to `earlier`.
  await pressUntilFocused(page, '.daily-nav__step--previous');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(dailyUrl(today));
  await pressUntilFocused(page, '.daily-nav__step--previous');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(dailyUrl(earlier));

  // Nothing before `earlier`: the button offers "Tạo ngày …" and creates that day.
  const dayBefore = isoAddDays(earlier, -1);
  const short = dayBefore.slice(5).split('-').reverse().join('/');
  await expect(page.locator('.daily-nav__step--previous')).toHaveText(`Tạo ngày ${short}`);
  await pressUntilFocused(page, '.daily-nav__step--previous');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(dailyUrl(dayBefore));
  await expect.poll(() => existsSync(vaultFile(`Daily/${dayBefore}.md`))).toBe(true);
  expect(await dailyFiles()).toHaveLength(4);
});

test('graph side panel by keyboard: find, read neighbours, open (F16.4)', async ({ page }) => {
  const api = await appApi(page);
  await createSampleData(api);
  const graph = await api.get<{
    nodes: { id: string; title: string }[];
    edges: { source: string; target: string }[];
  }>('/api/graph');
  const selected = '2 Areas/Giải tích 1.md';
  const neighbourIds = new Set(
    graph.edges.flatMap((e) =>
      e.source === selected ? [e.target] : e.target === selected ? [e.source] : [],
    ),
  );
  const expected = graph.nodes.filter((n) => neighbourIds.has(n.id)).map((n) => n.title);
  expect(expected.length).toBeGreaterThan(0);

  await page.goto('/#/graph');
  await expect(page.locator('.graph-legend')).toBeVisible();
  await pressUntilFocused(page, '.graph-panel [role="combobox"]');
  await page.keyboard.type('giải tích 1');
  await expect(page.locator('.graph-results__item').first()).toBeVisible();
  await expect(page.locator('.graph-results__item.is-active .graph-results__title')).toHaveText(
    'Giải tích 1',
  );
  await page.keyboard.press('Enter');
  const details = page.locator('.graph-details');
  await expect(details.locator('.graph-details__title')).toHaveText('Giải tích 1');
  const listed = await details
    .locator('.graph-neighbors')
    .first()
    .locator('.graph-neighbors__title')
    .allTextContents();
  expect(listed.sort()).toEqual([...expected].sort());

  await pressUntilFocused(page, '.graph-details__actions .button--primary');
  await expectFocus(page, '.graph-details__actions .button--primary');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/path=2%20Areas%2FGi/);
  await expect(page.getByRole('textbox', { name: /Tiêu đề ghi chú/ })).toHaveValue('Giải tích 1');
});
