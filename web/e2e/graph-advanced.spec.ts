/// <reference lib="dom" />
// Brain map advanced (F24.1–F24.3) in a real browser, Bento style. The fixture is written through
// the API, then – with the server stopped – its lines in `events.jsonl` and the files' mtimes are
// moved back week by week (as if she had written them over six weeks), plus a note created and
// deleted in between. Checked: the time scrubber by keyboard (week label, counts at the end of
// each week, a deleted note found in the past, End = the live map), "Phát", filters (folder chips,
// tag, time) that dim the rest and narrow the side panel, remembered after a reload, the
// `#/graph?when=today` link, "sửa trong 24 giờ" for a note edited now, reduced motion, and the API
// (filter matches, token required, GET writes nothing).
import { readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, request as apiRequest, test, type Page } from '@playwright/test';
import { localIso } from './helpers/app-api.js';
import { createNote, rewriteNote, vaultFile } from './helpers/m5-app.js';
import { ownServer, type OwnServer } from './helpers/own-server.js';
import { shot } from './helpers/screenshots.js';

const COURSE = '2 Areas/Giải tích 1.md';
// At the vault root ("Khác"): a `.md` note under 3 Resources would be a source node.
const OLD = 'Ghi chép cũ.md';
const GHOST = '0 Inbox/Ý tưởng cũ.md';
const PROJECT = '1 Projects/Đồ án Giải tích.md';
const IDEA = '1 Projects/Ý tưởng hay.md';
const DAILY = `Daily/${localIso()}.md`;

/** Local Monday 00:00 of this week, minus `weeks` weeks, plus `days` days at 10:00. */
function weekDay(weeks: number, days = 1): Date {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * weeks + days, 10);
}
const mondayLabel = (weeks: number) => {
  const d = weekDay(weeks, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/** When each fixture note first appeared (weeks back from this one). */
const BACKDATE: Record<string, Date> = {
  [COURSE]: weekDay(5, 1),
  [OLD]: weekDay(5, 2),
  [PROJECT]: weekDay(3, 1),
  [IDEA]: weekDay(1, 1),
};

let server: OwnServer;
test.beforeAll(async () => {
  server = ownServer(47693, { style: 'bento' });
  await server.start();
  const api = await server.api();
  await createNote(api, COURSE, '---\ntype: course\ntags: [môn/giải-tích]\n---\n\n# Giải tích 1\n');
  await createNote(api, OLD, '# Ghi chép cũ\n\nGhi chép từ học kỳ trước.\n');
  await createNote(
    api,
    PROJECT,
    '---\ntype: project\nstatus: doing\ntags: [đồ-án]\n---\n\n# Đồ án\n\nMôn [[Giải tích 1]].\n',
  );
  await createNote(api, IDEA, '# Ý tưởng hay\n');
  await createNote(api, DAILY, '# Hôm nay\n\nLàm tiếp [[Đồ án Giải tích]].\n');
  await server.stop();

  // The log: these notes (and their links) appeared weeks ago; one more note lived from week -4
  // to week -2. Lines stay in time order.
  const log = path.join(server.vaultDir, '.secondbrain', 'state', 'events.jsonl');
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  const moved = lines.map((text) => {
    const event = JSON.parse(text) as { ts: string; path: string };
    const when = BACKDATE[event.path];
    return when ? JSON.stringify({ ...event, ts: when.toISOString() }) : text;
  });
  const ghost = [
    { ts: weekDay(4).toISOString(), event: 'note_created', path: GHOST },
    { ts: weekDay(2).toISOString(), event: 'note_deleted', path: GHOST },
  ].map((line) => JSON.stringify(line));
  const sorted = [...moved, ...ghost].sort(
    (a, b) => Date.parse(JSON.parse(a).ts) - Date.parse(JSON.parse(b).ts),
  );
  writeFileSync(log, `${sorted.join('\n')}\n`);
  for (const [notePath, when] of Object.entries(BACKDATE)) {
    utimesSync(vaultFile(server, notePath), when, when);
  }
  await server.start();
});
test.afterAll(async () => server.dispose());

const slider = (page: Page) => page.getByRole('slider', { name: 'Tuần đang xem' });
const weekText = (page: Page) => page.locator('.graph-time__week');
const counts = (page: Page) => page.locator('.graph-time__counts');
const chip = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Bộ lọc' }).getByRole('button', { name, exact: true });
const matches = (page: Page) =>
  page.getByRole('listbox', { name: 'Ghi chú khớp' }).locator('.graph-results__title');

async function openMap(page: Page, hash = '#/graph'): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${server.origin}/${hash}`);
  await expect(page.locator('canvas.graph-screen__canvas')).toBeVisible();
}

test('the time scrubber by keyboard: each week as it ended, a deleted note in the past, End is live (F24.1)', async ({
  page,
}) => {
  await openMap(page);
  const range = slider(page);
  await expect(range).toBeVisible();
  await expect(weekText(page)).toHaveText(`Tuần ${mondayLabel(0)}, bây giờ`);
  const live = (await counts(page).textContent()) ?? '';
  await range.focus();
  await page.keyboard.press('Home');
  await expect(weekText(page)).toHaveText(`Tuần ${mondayLabel(5)}`);
  const expected: [number, string][] = [
    [5, '2 ghi chú, 0 liên kết'],
    [4, '3 ghi chú, 0 liên kết'],
    [3, '4 ghi chú, 1 liên kết'],
    [2, '3 ghi chú, 1 liên kết'],
    [1, '4 ghi chú, 1 liên kết'],
  ];
  for (const [weeksBack, text] of expected) {
    await expect(weekText(page)).toHaveText(`Tuần ${mondayLabel(weeksBack)}`);
    await expect(counts(page)).toHaveText(text);
    await expect(range).toHaveAttribute(
      'aria-valuetext',
      `Tuần ${mondayLabel(weeksBack)}: ${text}`,
    );
    await page.keyboard.press('ArrowRight');
  }
  await expect(weekText(page)).toHaveText(`Tuần ${mondayLabel(0)}, bây giờ`);
  await expect(counts(page)).toHaveText(live);
  // Back from now: week -2 (the note of week -4 is gone again), -3, then -4 where it lived.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(counts(page)).toHaveText('3 ghi chú, 1 liên kết');
  await page.keyboard.press('ArrowLeft');
  await expect(counts(page)).toHaveText('4 ghi chú, 1 liên kết');
  await page.keyboard.press('ArrowLeft');
  await expect(counts(page)).toHaveText('3 ghi chú, 0 liên kết');
  await expect(weekText(page)).toHaveText(`Tuần ${mondayLabel(4)}`);
  const search = page.getByRole('combobox', { name: 'Tìm ghi chú' });
  await search.fill('y tuong cu');
  await expect(page.getByRole('option', { name: /Ý tưởng cũ/ })).toBeVisible();
  await search.fill('');
  await range.focus();
  await page.keyboard.press('End');
  await expect(weekText(page)).toHaveText(`Tuần ${mondayLabel(0)}, bây giờ`);
  await expect(counts(page)).toHaveText(live);
  await search.fill('y tuong cu');
  await expect(page.getByText('Không có ghi chú nào tên "y tuong cu".')).toBeVisible();
  await shot(page, 'bento-graph-scrubber');
});

test('"Phát" plays week by week up to now; reduced motion turns it off and says why (F24.1, F24.3)', async ({
  page,
  browser,
}) => {
  await openMap(page);
  await slider(page).focus();
  await page.keyboard.press('Home');
  await expect(weekText(page)).toHaveText(`Tuần ${mondayLabel(5)}`);
  const play = page.getByRole('button', { name: 'Phát' });
  await play.click();
  await expect(page.getByRole('button', { name: 'Dừng' })).toBeVisible();
  await expect(weekText(page)).toHaveText(`Tuần ${mondayLabel(3)}`, { timeout: 5_000 });
  await expect(weekText(page)).toHaveText(`Tuần ${mondayLabel(0)}, bây giờ`, { timeout: 8_000 });
  await expect(page.getByRole('button', { name: 'Phát' })).toBeVisible();
  await expect(page.getByText('Chấm đập nhẹ là ghi chú sửa trong 24 giờ qua.')).toBeVisible();

  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const still = await context.newPage();
  await still.setViewportSize({ width: 1440, height: 1000 });
  await still.goto(`${server.origin}/#/graph`);
  await expect(still.getByRole('button', { name: 'Phát' })).toBeDisabled();
  await expect(still.getByText(/^Phát đang tắt vì máy bạn bật giảm chuyển động\./)).toBeVisible();
  await expect(still.getByText('Chấm có vòng là ghi chú sửa trong 24 giờ qua.')).toBeVisible();
  await expect(still.getByText('Chấm đập nhẹ là ghi chú sửa trong 24 giờ qua.')).toHaveCount(0);
  await context.close();
});

test('filters dim the rest and narrow the side panel; remembered after a reload (F24.2)', async ({
  page,
}) => {
  await openMap(page);
  await chip(page, 'Projects').click();
  await expect(chip(page, 'Projects')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('2 ghi chú khớp bộ lọc')).toBeVisible();
  expect((await matches(page).allTextContents()).sort()).toEqual([
    'Ý tưởng hay',
    'Đồ án Giải tích',
  ]);
  // A second folder adds its notes (folders combine with "or").
  await chip(page, 'Areas').click();
  expect((await matches(page).allTextContents()).sort()).toEqual([
    'Giải tích 1',
    'Ý tưởng hay',
    'Đồ án Giải tích',
  ]);
  // Search stays inside the filter.
  const search = page.getByRole('combobox', { name: 'Tìm ghi chú' });
  await search.fill('ghi chep');
  await expect(
    page.getByText('Không có ghi chú nào tên "ghi chep" trong bộ lọc này.'),
  ).toBeVisible();
  await search.fill('');
  await page.reload();
  await expect(chip(page, 'Projects')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, 'Areas')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Bỏ lọc' }).click();
  await expect(chip(page, 'Projects')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText(/ghi chú khớp bộ lọc/)).toHaveCount(0);

  // Tag (any spelling of #đồ-án), then time: "7 ngày qua" leaves out the backdated notes. The
  // filter says "Thẻ" like the rest of the app (review B5).
  const tag = page.getByRole('combobox', { name: 'Thẻ', exact: true });
  await expect(tag.locator('option').first()).toHaveText('Mọi thẻ');
  const option = (await tag.locator('option').allTextContents()).find((t) => t.includes('đồ-án'));
  expect(option).toBeTruthy();
  await tag.selectOption({ label: option! });
  expect(await matches(page).allTextContents()).toEqual(['Đồ án Giải tích']);
  await tag.selectOption({ index: 0 });
  await chip(page, '7 ngày qua').click();
  const recent = await matches(page).allTextContents();
  expect(recent).toContain(localIso());
  for (const old of ['Giải tích 1', 'Ghi chép cũ', 'Đồ án Giải tích', 'Ý tưởng hay']) {
    expect(recent).not.toContain(old);
  }
  // Non-matching dots dim (the canvas draws them at 20 %): the side panel and API agree.
  await chip(page, 'Mọi lúc').click();
  await expect(page.getByText(/ghi chú khớp bộ lọc/)).toHaveCount(0);
});

test('#/graph?when=today, "sửa trong 24 giờ" for a note edited now (F24.2, F24.3, F24.4)', async ({
  page,
}) => {
  await openMap(page, '#/graph?when=today');
  await expect(chip(page, 'Hôm nay')).toHaveAttribute('aria-pressed', 'true');
  const listed = await matches(page).allTextContents();
  expect(listed).toContain(localIso());
  expect(listed).not.toContain('Giải tích 1');
  await expect(
    page.getByRole('option', { name: new RegExp(`^${localIso()}.*sửa trong 24 giờ`) }),
  ).toBeVisible();

  // The course was last written five weeks ago: no mark, until she edits it now. (A new visit
  // without `when` shows the remembered filter: none here.)
  await page.goto(`${server.origin}/#/graph`);
  await page.reload();
  await expect(chip(page, 'Mọi lúc')).toHaveAttribute('aria-pressed', 'true');
  const search = page.getByRole('combobox', { name: 'Tìm ghi chú' });
  await search.fill('giai tich 1');
  const course = page.getByRole('option', { name: /^Giải tích 1/ });
  await expect(course).toBeVisible();
  await expect(course.locator('.graph-recent')).toHaveCount(0);
  await rewriteNote(
    await server.api(),
    COURSE,
    '---\ntype: course\ntags: [môn/giải-tích]\n---\n\n# Giải tích 1\n\nSửa hôm nay.\n',
  );
  await page.reload();
  await search.fill('giai tich 1');
  await expect(course.locator('.graph-recent')).toHaveText('sửa trong 24 giờ');
  await course.click();
  await expect(page.locator('.graph-panel').getByText('sửa trong 24 giờ').first()).toBeVisible();
});

test('API: filter matches, the token is required, GET writes nothing (F24.1, F24.2)', async () => {
  const api = await server.api();
  const log = path.join(server.vaultDir, '.secondbrain', 'state', 'events.jsonl');
  const before = statSync(log).size;
  const filtered = await api.get<{ matches: string[] }>(
    `/api/graph?folder=${encodeURIComponent('1 Projects')}`,
  );
  expect(filtered.matches.sort()).toEqual([IDEA, PROJECT].sort());
  const tagged = await api.get<{ matches: string[] }>(
    `/api/graph?tag=${encodeURIComponent('#Đồ-án')}`,
  );
  expect(tagged.matches).toEqual([PROJECT]);
  const since = await api.get<{ matches: string[] }>(`/api/graph?since=${localIso()}`);
  expect(since.matches).toContain(DAILY);
  expect(since.matches).not.toContain(OLD);
  const history = await api.get<{ firstWeek: string; nodes: { id: string; removedAt?: number }[] }>(
    '/api/graph/history',
  );
  expect(history.nodes.find((n) => n.id === GHOST)?.removedAt).toBeGreaterThan(0);
  const anonymous = await apiRequest.newContext({ baseURL: server.origin });
  expect((await anonymous.get('/api/graph/history')).status()).toBe(401);
  expect((await anonymous.get(`/api/graph?since=${localIso()}`)).status()).toBe(401);
  await anonymous.dispose();
  expect(statSync(log).size).toBe(before);
});
