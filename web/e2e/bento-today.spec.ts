/// <reference lib="dom" />
// S1 in the Bento style (F35.4, F35.8, F35.9, F24.4) in a real browser, on a fixture written
// through the API: greeting, the tinted date tile, the nearest deadline (today, then 2 days, then
// none), the 14-day strip (overdue cell, urgency bars, "+n", popover tick and open, roving keys),
// "Hôm nay" rows with their sub-lines and a tick that patches one line, the encouragement from a
// task done yesterday, project rings with "Xem thêm", "Não hôm nay" counts that follow new notes
// and links and open the map filtered to today, "Ghi nhanh" into Inbox, the 7-day bars' name, the
// grid proportions, one primary button, and every tile's invitation once the vault is empty.
import { expect, test, type Page } from '@playwright/test';
import { isoAddDays, localIso, type AppApi } from './helpers/app-api.js';
import { expectFocus, focusedInfo, pressUntilFocused } from './helpers/keyboard.js';
import { DENSE_DAY_OFFSET, DENSE_NOTE, denseNoteContent } from './helpers/dense-fixture.js';
import { tr, vietnameseLeftovers } from './helpers/locale-strings.js';
import {
  collectConsoleErrors,
  createNote,
  expectNoSidewaysScroll,
  introSeen,
  mainNav,
  readVault,
  recordIntroClasses,
  tokenColor,
  visiblePrimaries,
} from './helpers/m5-app.js';
import { ownServer, type OwnServer } from './helpers/own-server.js';
import { shot } from './helpers/screenshots.js';

let server: OwnServer;
test.beforeEach(async () => {
  server = ownServer(47690, { style: 'bento' });
  await server.start();
});
test.afterEach(async () => server.dispose());

interface TodayActivity {
  days: { date: string; count: number }[];
  doneYesterday: number;
  brain: { notesTouched: number; notesNew: number; linksAdded: number; aiTouched: number };
}

const T = localIso();
const day = (offset: number) => isoAddDays(T, offset);
const PROJECT = '1 Projects/Đồ án Giải tích.md';
const RESEARCH = '1 Projects/Nghiên cứu nhóm.md';
const EMPTY_PROJECT = '1 Projects/Đồ án chưa có việc.md';
const DAILY = `Daily/${T}.md`;
const YESTERDAY = `Daily/${day(-1)}.md`;

async function writeFixture(api: AppApi): Promise<void> {
  await createNote(
    api,
    PROJECT,
    `---\ntype: project\nstatus: doing\ndeadline: ${day(12)}\n---\n\n# Đồ án Giải tích\n\n` +
      `- [x] Chọn đề tài ✅ ${day(-6)}\n- [x] Đọc chương 1 ✅ ${day(-4)}\n- [x] Lập dàn ý ✅ ${day(-3)}\n` +
      `- [ ] Giải bài tập chương 3 📅 ${day(2)}\n- [ ] Viết bản nháp 📅 ${day(5)}\n`,
  );
  await createNote(
    api,
    RESEARCH,
    `---\ntype: project\nstatus: doing\ndeadline: ${day(20)}\n---\n\n# Nghiên cứu nhóm\n\n` +
      `- [x] Đọc bài báo ✅ ${day(-1)}\n- [ ] Tóm tắt bài báo 📅 ${day(2)}\n` +
      `- [ ] Gặp thầy hướng dẫn 📅 ${day(2)}\n- [ ] Gửi bảng số liệu 📅 ${day(2)}\n`,
  );
  await createNote(api, EMPTY_PROJECT, `---\ntype: project\nstatus: doing\n---\n\n# Trống\n`);
  await createNote(
    api,
    YESTERDAY,
    `---\ntype: daily\n---\n\n- [ ] Gửi email hỏi thầy 📅 ${day(-1)}\n`,
  );
  await createNote(
    api,
    DAILY,
    `---\ntype: daily\n---\n\n- [ ] Nộp bài tập Xác suất 📅 ${T}\n- [ ] Ôn công thức Bayes\n`,
  );
}

/** SPEC F10.1 greeting, Bento wording (the name on its own line). */
function greetingPrefix(now = new Date()): string {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes >= 5 * 60 && minutes < 11 * 60) return 'Chào buổi sáng';
  if (minutes >= 11 * 60 && minutes < 13 * 60 + 30) return 'Chào buổi trưa';
  if (minutes >= 13 * 60 + 30 && minutes < 18 * 60) return 'Chào buổi chiều';
  if (minutes >= 18 * 60 && minutes < 23 * 60) return 'Chào buổi tối';
  return 'Chào khuya';
}

const tile = (page: Page, name: string | RegExp) =>
  page.getByRole('region', { name, exact: typeof name === 'string' });

/** Boxes of the Today tiles, in DOM order. */
function tileBoxes(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.today-bento__grid > .today-tile')].map((el) => {
      const r = el.getBoundingClientRect();
      const kind = [...el.classList].find((c) => c.startsWith('today-tile--'))!.slice(12);
      return { kind, x: r.left, y: r.top, w: r.width, h: r.height };
    }),
  );
}

test('S1 in Bento: tiles, deadline, strip, ticks, rings, brain, capture, bars (F35.4, F35.9, F24.4)', async ({
  page,
}) => {
  test.slow();
  const api = await server.api();
  await writeFixture(api);
  const errors = collectConsoleErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${server.origin}/`);

  // Lời chào: the time of day, the name on its own line; the summary sentence.
  const greeting = page.locator('#today-greeting');
  await expect(greeting).toHaveText(new RegExp(`^${greetingPrefix()},\\s*khangnie`));
  await expect(page.locator('.today-greeting__name')).toHaveText('khangnie');
  await expect(page.locator('.today-greeting__summary')).toHaveText(/Có 1 việc quá hạn\./);

  // Ngày: the tint with --on-tint text, the 64 px / 800 day number.
  const date = page.locator('.today-tile--date');
  await expect(tile(page, 'Ngày hôm nay')).toBeVisible();
  await expect(date.locator('.today-date__day')).toHaveText(String(new Date().getDate()));
  const dateLook = await date.evaluate((el) => {
    const day = el.querySelector('.today-date__day')!;
    return {
      background: getComputedStyle(el).backgroundImage,
      color: getComputedStyle(el).color,
      size: getComputedStyle(day).fontSize,
      weight: getComputedStyle(day).fontWeight,
    };
  });
  expect(dateLook.background, 'the date tile is --tint').toContain('160deg');
  expect(dateLook.background).toMatch(/rgb\(233, 215, 255\)|#e9d7ff/i);
  expect(dateLook.color).toBe(await tokenColor(page, '--on-tint'));
  expect(dateLook).toMatchObject({ size: '64px', weight: '800' });

  // Deadline gần nhất: due today → "Hôm nay" with the "gấp" pill.
  const deadline = tile(page, 'Deadline gần nhất');
  await expect(deadline.locator('.today-deadline__number')).toHaveText('Hôm nay');
  await expect(deadline.locator('.today-pill')).toHaveText('gấp');
  await expect(
    deadline.getByRole('button', { name: 'Mở ghi chú Nộp bài tập Xác suất' }),
  ).toBeVisible();
  // The task lives in today's Daily, whose title is the date: the detail says it once (D4).
  const detail = deadline.locator('.today-deadline__detail');
  await expect(detail).toHaveText(/^(Thứ (hai|ba|tư|năm|sáu|bảy)|Chủ nhật) \d{1,2}\/\d{1,2}$/);
  await expect(detail).not.toContainText(T);

  // Hôm nay: overdue, due today, undated Daily; "0/3 xong"; rows ≥ 52 px; square checkboxes.
  const tasks = tile(page, 'Hôm nay');
  const rows = tasks.locator('.today-task');
  await expect(rows).toHaveCount(3);
  await expect(tasks.locator('.today-tile__meta')).toHaveText('0/3 xong');
  const sub = (title: string) =>
    tasks.locator('.today-task').filter({ hasText: title }).locator('.today-task__sub');
  await expect(sub('Gửi email hỏi thầy')).toHaveText('Quá hạn 1 ngày');
  await expect(sub('Nộp bài tập Xác suất')).toHaveText('Hôm nay, gấp');
  await expect(sub('Ôn công thức Bayes')).toHaveText('Daily hôm nay');
  for (const height of await rows.evaluateAll((list) =>
    list.map((li) => li.getBoundingClientRect().height),
  )) {
    expect(height).toBeGreaterThanOrEqual(52);
  }
  const box = await tasks
    .locator('.deadline-check__box')
    .first()
    .evaluate((el) => ({
      w: el.getBoundingClientRect().width,
      radius: getComputedStyle(el).borderRadius,
      hit: el.parentElement!.getBoundingClientRect().width,
    }));
  expect(box).toMatchObject({ w: 20, radius: '7px' });
  expect(box.hit).toBeGreaterThanOrEqual(24);
  // The encouragement counts the task ticked yesterday.
  await expect(tasks.locator('.today-tasks__cheer')).toHaveText(
    'Hôm qua bạn xong 1 việc. Giữ nhịp nhé.',
  );

  // Tick "Nộp bài tập Xác suất": exactly that line, "1/3 xong", and the nearest deadline moves
  // to the day after tomorrow: "2 ngày nữa", still "gấp".
  const before = readVault(server, DAILY)!;
  await tasks.getByRole('checkbox', { name: 'Nộp bài tập Xác suất' }).check();
  await expect(tasks.locator('.today-tile__meta')).toHaveText('1/3 xong');
  await expect.poll(() => readVault(server, DAILY)).not.toBe(before);
  expect(readVault(server, DAILY)).toBe(
    before.replace(
      `- [ ] Nộp bài tập Xác suất 📅 ${T}`,
      `- [x] Nộp bài tập Xác suất 📅 ${T} ✅ ${T}`,
    ),
  );
  await expect(deadline.locator('.today-deadline__number')).toHaveText('2');
  await expect(deadline.locator('.today-deadline__unit')).toHaveText('ngày nữa');
  await expect(detail).toHaveText(/, (Đồ án Giải tích|Nghiên cứu nhóm)$/);
  await expect(deadline.locator('.today-pill')).toHaveText('gấp');
  const countLook = await deadline
    .locator('.today-deadline__number')
    .evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight]);
  expect(countLook).toEqual(['56px', '800']);

  // 14 ngày tới: overdue cell first, urgency bars 28×6 in the urgency colours, ≤ 2 labels + "+n".
  const strip = page.locator('.today-strip--bento');
  await expect(strip.locator('.today-strip__cell--overdue')).toContainText('Quá hạn (1)');
  const cell = (iso: string) => strip.locator(`.today-strip__cell[data-key="${iso}"]`);
  await expect(cell(day(2)).locator('.today-strip__label')).toHaveCount(2);
  await expect(cell(day(2)).locator('.today-strip__more')).toHaveText('+2');
  const barColor = (iso: string) =>
    cell(iso)
      .locator('.today-strip__dot')
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { color: getComputedStyle(el).backgroundColor, w: r.width, h: r.height };
      });
  expect(await barColor(day(2))).toEqual({
    color: await tokenColor(page, '--urgent'),
    w: 28,
    h: 6,
  });
  expect((await barColor(day(5))).color).toBe(await tokenColor(page, '--soon'));
  expect((await barColor(day(12))).color).toBe(await tokenColor(page, '--ok'));
  expect((await barColor(day(3))).color).toBe(await tokenColor(page, '--line'));
  expect(
    await strip
      .locator('.today-strip__cell--overdue .today-strip__dot')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe(await tokenColor(page, '--urgent'));
  await expect(cell(T)).toHaveAttribute('aria-current', 'date');
  const cellRadius = await cell(day(1)).evaluate((el) => getComputedStyle(el).borderRadius);
  expect(cellRadius).toBe('18px');

  // Popover of the day after tomorrow: four rows; a tick patches the research note; the title
  // opens it (then back to Today).
  await cell(day(2)).click();
  const popover = page.locator('.today-strip__popover');
  await expect(popover.locator('li')).toHaveCount(4);
  const research = readVault(server, RESEARCH)!;
  await popover.getByRole('checkbox', { name: 'Gặp thầy hướng dẫn' }).check();
  await expect
    .poll(() => readVault(server, RESEARCH))
    .toBe(
      research.replace(
        `- [ ] Gặp thầy hướng dẫn 📅 ${day(2)}`,
        `- [x] Gặp thầy hướng dẫn 📅 ${day(2)} ✅ ${T}`,
      ),
    );
  await popover.getByRole('button', { name: 'Mở ghi chú Tóm tắt bài báo' }).click();
  await expect(page.getByRole('textbox', { name: /Tiêu đề ghi chú/ })).toHaveValue(
    'Nghiên cứu nhóm',
  );
  await page.goBack();
  await expect(strip).toBeVisible();

  // Keyboard: one tab stop on today, arrows, End = day 60, Home = the overdue cell, Enter + Esc.
  await page.locator('#today-greeting').focus();
  await pressUntilFocused(page, '.today-strip__cell');
  expect((await focusedInfo(page)).key).toBe(T);
  await page.keyboard.press('ArrowRight');
  expect((await focusedInfo(page)).key).toBe(day(1));
  await page.keyboard.press('End');
  expect((await focusedInfo(page)).key).toBe(day(59));
  await page.keyboard.press('Home');
  await expectFocus(page, '.today-strip__cell--overdue');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Quá hạn (1)' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Quá hạn (1)' })).toHaveCount(0);
  await expectFocus(page, '.today-strip__cell--overdue');

  // Đồ án đang làm: two rings (76 px), "chưa có việc" for the project without tasks, and "Xem
  // thêm 1 đồ án" reveals the third.
  const projects = tile(page, 'Đồ án đang làm');
  await expect(projects.locator('.today-ring')).toHaveCount(2);
  await expect(
    projects.getByRole('img', { name: 'Tiến độ Đồ án Giải tích: 60 phần trăm, 3/5 việc' }),
  ).toBeVisible();
  const ringSize = await projects
    .locator('.today-ring__svg')
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(ringSize).toBe(76);
  await projects.getByRole('button', { name: 'Xem thêm 1 đồ án' }).click();
  await expect(projects.locator('.today-ring')).toHaveCount(3);
  await expect(projects.locator('.today-ring__none')).toHaveText('chưa có việc');
  await expectFocus(page, '.today-ring:nth-child(3) .today-ring__title');

  // Não hôm nay and 7 ngày ghi chép: the server's counts; then a new linking note raises both
  // chips and today's bar. The region is named by its title; the link says where it goes, with
  // no stray space before the comma (D5).
  const brain = tile(page, 'Não hôm nay');
  await expect(
    brain.getByRole('link', { name: 'Não hôm nay, mở Bản đồ não', exact: true }),
  ).toBeVisible();
  expect(await brain.evaluate((el) => (el as HTMLElement).innerText.trimStart())).toMatch(
    /^Não hôm nay/,
  );
  const activity = async () => (await api.get<{ activity: TodayActivity }>('/api/today')).activity;
  const first = await activity();
  expect(first.brain).toMatchObject({ notesTouched: 5, linksAdded: 0 });
  expect(first.doneYesterday).toBe(1);
  await expect(brain.locator('.today-chip--notes')).toHaveText('+5 ghi chú');
  await expect(brain.locator('.today-chip--links')).toHaveText('+0 liên kết');
  await expect(brain.locator('.today-chip--ai')).toHaveCount(0);
  await createNote(api, '2 Areas/Giải tích 1.md', '# Giải tích 1\n\nXem [[Đồ án Giải tích]].\n');
  await expect(brain.locator('.today-chip--notes')).toHaveText('+6 ghi chú');
  await expect(brain.locator('.today-chip--links')).toHaveText('+1 liên kết');
  const after = await activity();
  expect(after.brain).toMatchObject({ notesTouched: 6, linksAdded: 1 });
  await expect(
    brain.getByRole('img', { name: /^Chòm sao \d+ ghi chú chạm hôm nay$/ }),
  ).toBeVisible();
  await expect(brain.locator('p.visually-hidden')).toContainText('Giải tích 1');

  const writing = tile(page, '7 ngày ghi chép');
  const bars = writing.getByRole('img');
  await expect(bars).toHaveAttribute('aria-label', /hôm nay: 6 ghi chú\.$/);
  const label = (await bars.getAttribute('aria-label'))!;
  expect(label.match(/: \d+ ghi chú/g)!.map((part) => Number(part.match(/\d+/)![0]))).toEqual(
    after.days.map((d) => d.count),
  );
  await expect(writing.locator('.today-bars__bar')).toHaveCount(7);
  expect(
    await writing
      .locator('.today-bars__bar.is-today')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe(await tokenColor(page, '--accent'));

  // Ghi nhanh: a 50 px field and a square "+"; Enter saves into Inbox and the brain counts it.
  const capture = tile(page, 'Ghi nhanh');
  const field = capture.getByRole('textbox', { name: 'Ghi nhanh' });
  expect(await field.evaluate((el) => el.getBoundingClientRect().height)).toBe(50);
  const plus = await capture
    .locator('.today-capture__save')
    .evaluate((el) => [
      getComputedStyle(el).borderRadius,
      el.classList.contains('button--primary'),
    ]);
  expect(plus).toEqual(['12px', false]);
  await expect(capture.locator('.today-tile__hint')).toHaveText(
    'Lưu vào Inbox. Alt+Q ở bất cứ đâu.',
  );
  await field.fill('Hỏi thầy về tiêu chí chấm');
  await field.press('Enter');
  await expect(field).toHaveValue('');
  await expect
    .poll(() => readVault(server, '0 Inbox/Hỏi thầy về tiêu chí chấm.md'))
    .toContain('Hỏi thầy về tiêu chí chấm');
  await expect(brain.locator('.today-chip--notes')).toHaveText('+7 ghi chú');

  // Grid (1440 px): 6 + 2 + 4, the strip across, then 5 (two rows) + 4 + 3 and 4 + 3; radius 26.
  const boxes = await tileBoxes(page);
  expect(boxes.map((b) => b.kind)).toEqual([
    'greeting',
    'date',
    'deadline',
    'strip',
    'tasks',
    'projects',
    'brain',
    'capture',
    'writing',
  ]);
  const at = Object.fromEntries(boxes.map((b) => [b.kind, b]));
  const strip12 = at.strip!.w;
  const column = (strip12 - 11 * 16) / 12;
  const span = (n: number) => n * column + (n - 1) * 16;
  for (const [kind, n] of [
    ['greeting', 6],
    ['date', 2],
    ['deadline', 4],
    ['tasks', 5],
    ['projects', 4],
    ['brain', 3],
    ['capture', 4],
    ['writing', 3],
  ] as const) {
    expect(Math.abs(at[kind]!.w - span(n)), `${kind} spans ${n} columns`).toBeLessThanOrEqual(1);
  }
  expect(at.date!.y).toBe(at.greeting!.y);
  expect(at.capture!.x).toBe(at.projects!.x);
  expect(at.writing!.x).toBe(at.brain!.x);
  expect(at.capture!.y).toBeGreaterThan(at.projects!.y + at.projects!.h);
  expect(Math.abs(at.tasks!.y + at.tasks!.h - (at.capture!.y + at.capture!.h))).toBeLessThanOrEqual(
    1,
  );
  expect(
    await page.locator('.today-tile--tasks').evaluate((el) => getComputedStyle(el).borderRadius),
  ).toBe('26px');

  // One primary button: the top bar's "Ghi chú mới".
  expect(await visiblePrimaries(page)).toEqual(['Ghi chú mới']);
  await shot(page, 'bento-today-1440');

  // The brain tile opens the map filtered to today.
  await brain.getByRole('link', { name: 'Não hôm nay, mở Bản đồ não' }).click();
  await expect(page).toHaveURL(/#\/graph\?when=today$/);
  await expect(page.getByRole('button', { name: 'Hôm nay', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(errors).toEqual([]);
});

test('every tile invites when there is nothing to show; no deadline within 14 days (F35.4)', async ({
  page,
}) => {
  const api = await server.api();
  // Only a deadline three weeks ahead: no number, the sentence instead.
  await createNote(
    api,
    PROJECT,
    `---\ntype: project\nstatus: doing\ndeadline: ${day(21)}\n---\n\n# Đồ án Giải tích\n`,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${server.origin}/`);
  const deadline = tile(page, 'Deadline gần nhất');
  await expect(deadline.locator('.today-tile__empty')).toHaveText(
    'Không có deadline nào trong 14 ngày tới.',
  );
  await expect(deadline.locator('.today-deadline__number')).toHaveCount(0);
  await expect(deadline.locator('.today-pill')).toHaveCount(0);
  await expect(tile(page, 'Hôm nay').locator('.today-tile__empty')).toHaveText(
    'Hôm nay chưa có việc nào. Nhớ ra việc gì thì gõ vào Ghi nhanh nhé.',
  );
  await expect(tile(page, 'Hôm nay').locator('.today-tasks__cheer')).toHaveCount(0);
  await expect(tile(page, 'Đồ án đang làm').locator('.today-ring__none')).toHaveText(
    'chưa có việc',
  );
  await expect(tile(page, 'Đồ án đang làm').locator('.today-ring__due')).toHaveText(/còn 21 ngày/);

  // The project goes to the trash: today's touch is dropped with it, every tile invites.
  const note = await api.get<{ revision: string }>(`/api/note?path=${encodeURIComponent(PROJECT)}`);
  await api.send('POST', '/api/note/trash', {
    paths: [PROJECT],
    expectedRevisions: [note.revision],
  });
  await expect(tile(page, 'Đồ án đang làm').locator('.today-tile__empty')).toBeVisible();
  await expect(tile(page, /^Não hôm nay/).locator('.today-tile__empty')).toHaveText(
    'Hôm nay chưa chạm ghi chú nào. Viết gì đó nhé?',
  );
  await expect(tile(page, '7 ngày ghi chép').locator('.today-tile__empty')).toHaveText(
    '7 ngày qua chưa có ghi chép nào. Bắt đầu một ghi chú nhé?',
  );
  await expectNoSidewaysScroll(page, 'empty Today 1280');
});

test('a fresh vault: the sample-data card holds the one primary button (F35.3, F35.4)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${server.origin}/`);
  const create = page.getByRole('button', { name: 'Tạo dữ liệu mẫu' });
  await expect(create).toBeVisible();
  await expect.poll(() => visiblePrimaries(page)).toEqual(['Tạo dữ liệu mẫu']);
  await expect(page.getByRole('button', { name: 'Ghi chú mới' })).toHaveClass(/button--secondary/);
  await create.click();
  await expect(page.getByText('Đã tạo dữ liệu mẫu.')).toBeVisible();
  await expect.poll(() => visiblePrimaries(page)).toEqual(['Ghi chú mới']);
  await expect(tile(page, 'Đồ án đang làm').locator('.today-ring')).not.toHaveCount(0);
});

test('first paint: bars left to right, rings and writing bars once; reduced motion: final state (F35.8)', async ({
  page,
  browser,
}) => {
  const api = await server.api();
  await writeFixture(api);
  await recordIntroClasses(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${server.origin}/`);
  await expect(page.locator('.today-bars')).toBeVisible();
  await expect.poll(() => introSeen(page)).toEqual(['bars', 'rings', 'strip']);
  // The bars start one after another, left to right, and all within 400 ms.
  const delays = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.today-strip--bento .today-strip__cell')]
      .slice(0, 15)
      .map(
        (cell) =>
          parseFloat(getComputedStyle(cell.querySelector('.today-strip__dot')!).animationDelay) *
          1000,
      ),
  );
  // (read while the intro runs or just after: an ended intro has no delay left to read)
  if (delays.some((d) => d > 0)) {
    expect([...delays].sort((a, b) => a - b)).toEqual(delays);
    expect(Math.max(...delays) + 160).toBeLessThanOrEqual(400);
  }
  // Played once: the classes go, and coming back to Today does not play it again.
  await expect(page.locator('.is-intro')).toHaveCount(0, { timeout: 2_000 });
  await page.evaluate(() => (window as unknown as { __intro: Set<string> }).__intro.clear());
  await mainNav(page).getByRole('link', { name: 'Lịch' }).click();
  await mainNav(page).getByRole('link', { name: 'Hôm nay' }).click();
  await expect(page.locator('.today-bars')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await introSeen(page)).toEqual([]);
  // Hover on a tile only brightens its border: no lift, no scale, no shadow.
  const tasksTile = page.locator('.today-tile--tasks');
  const rest = await tasksTile.evaluate((el) => ({
    box: el.getBoundingClientRect().toJSON(),
    shadow: getComputedStyle(el).boxShadow,
    border: getComputedStyle(el).backgroundImage,
  }));
  await tasksTile.hover({ position: { x: 8, y: 8 } });
  const hovered = await tasksTile.evaluate((el) => ({
    box: el.getBoundingClientRect().toJSON(),
    shadow: getComputedStyle(el).boxShadow,
    border: getComputedStyle(el).backgroundImage,
  }));
  expect(hovered.box).toEqual(rest.box);
  expect(hovered.shadow).toBe('none');
  expect(hovered.border).not.toBe(rest.border);

  // Reduced motion: no intro class ever, rings and bars at their final size at once.
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const still = await context.newPage();
  await recordIntroClasses(still);
  await still.setViewportSize({ width: 1440, height: 1000 });
  await still.goto(`${server.origin}/`);
  await expect(still.locator('.today-bars')).toBeVisible();
  await still.waitForTimeout(300);
  expect(await introSeen(still)).toEqual([]);
  const animated = await still.evaluate(
    () =>
      [
        ...document.querySelectorAll('.today-strip__dot, .today-ring__value, .today-bars__bar'),
      ].filter((el) => getComputedStyle(el).animationName !== 'none').length,
  );
  expect(animated).toBe(0);
  await context.close();
});

test('Bento Today in English: no Vietnamese UI text left (F35.4, F19.2)', async ({ page }) => {
  const api = await server.api();
  await writeFixture(api);
  await api.send('PUT', '/api/settings', { ui: { language: 'en' } });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${server.origin}/`);
  for (const key of [
    'today.bento.deadline.title',
    'today.bento.projects.title',
    'today.bento.capture.title',
    'today.bento.writing.title',
  ]) {
    await expect(page.getByRole('heading', { level: 2, name: tr('en', key) })).toBeVisible();
  }
  await expect(page.locator('.today-tasks__cheer')).toHaveText(
    tr('en', 'today.bento.tasks.yesterday_one', { count: 1 }),
  );
  await expect(page.getByRole('button', { name: tr('en', 'rail.searchLabel') })).toBeVisible();
  // Task, project, note titles and strip labels are hers (Vietnamese), not UI.
  const content = [
    '.today-task__title',
    '.today-task__open',
    '.today-deadline__item',
    '.today-deadline__detail',
    '.today-strip__label',
    '.today-ring__title',
    '.today-brain__map',
    '.today-tile--brain p.visually-hidden',
  ];
  await expect.poll(() => vietnameseLeftovers(page, content)).toEqual([]);
});

for (const width of [360, 720, 1280]) {
  test(`dense Today in Bento at ${width} px: +n, Quá hạn (30), no sideways scroll (F10.2, F35.5)`, async ({
    page,
  }) => {
    const api = await server.api();
    await createNote(api, DENSE_NOTE, denseNoteContent(T));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${server.origin}/`);
    const strip = page.locator('.today-strip--bento');
    const overdue = strip.locator('.today-strip__cell--overdue');
    await expect(overdue.locator('.today-strip__heading')).toHaveText('Quá hạn (30)');
    await expect(overdue.locator('.today-strip__more')).toHaveText('+28');
    const dense = strip.locator(`.today-strip__cell[data-key="${day(DENSE_DAY_OFFSET)}"]`);
    await expect(dense.locator('.today-strip__label')).toHaveCount(2);
    await expect(dense.locator('.today-strip__more')).toHaveText('+8');
    // Bento (FIX-B decision, review B3 / D1): as many whole days as fit at ≥ 66 px; the rest
    // scroll inside the tile (calm keeps F10's "7 below 720 px").
    await expectReadableStrip(page, `dense ${width}`);
    // Labels stay inside their cells (≤ 2 lines each).
    const outside = await strip.evaluate(
      (el) =>
        [...el.querySelectorAll<HTMLElement>('.today-strip__label')].filter((label) => {
          const cell = label.closest('.today-strip__cell')!.getBoundingClientRect();
          const box = label.getBoundingClientRect();
          return (
            box.width > 0 &&
            (box.left < cell.left - 1 || box.right > cell.right + 1 || box.bottom > cell.bottom + 1)
          );
        }).length,
    );
    expect(outside).toBe(0);
    // Below 960 px every tile takes the full width (two-column grid, F35.5).
    if (width < 960) {
      const widths = await page.evaluate(() =>
        [...document.querySelectorAll('.today-bento__grid > .today-tile')].map((el) =>
          Math.round(el.getBoundingClientRect().width),
        ),
      );
      expect(new Set(widths).size, `tile widths ${widths.join(', ')}`).toBe(1);
    }
    await expectNoSidewaysScroll(page, `dense Today ${width}`);
    await dense.click();
    const popover = page.locator('.today-strip__popover');
    await expect(popover.locator('li')).toHaveCount(10);
    const edge = await popover.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return Math.min(r.left, window.innerWidth - r.right);
    });
    expect(edge).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Escape');
    await shot(page, `bento-today-dense-${width}`);
  });
}

/**
 * The Bento strip at this width: every cell ≥ 66 px (and 4.125rem), no day number cut ("1/11",
 * "Nov 1"), `data-visible-days` whole cells in view, and a sideways scroll inside the tile for
 * the rest (review B3, E2E D1).
 */
async function expectReadableStrip(page: Page, what: string): Promise<number> {
  const strip = page.locator('.today-strip--bento');
  await expect(strip).toBeVisible();
  const facts = await strip.evaluate((el) => {
    const scroller = el.querySelector<HTMLElement>('.today-strip__scroller')!;
    const box = scroller.getBoundingClientRect();
    const cells = [...scroller.querySelectorAll<HTMLElement>('.today-strip__cell')];
    const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return {
      days: Number((el as HTMLElement).dataset.visibleDays),
      min: Math.max(66, 4.125 * rootFont),
      widths: cells.map((c) => c.getBoundingClientRect().width),
      inView: cells.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left >= box.left - 1 && r.right <= box.right + 1;
      }).length,
      cut: cells
        .map((c) => c.querySelector<HTMLElement>('.today-strip__day')!)
        .filter((d) => d.scrollWidth > d.clientWidth + 0.5)
        .map((d) => d.textContent),
      scrolls: scroller.scrollWidth > scroller.clientWidth,
      monthStarts: cells.filter((c) => c.dataset.key?.endsWith('-01')).length,
    };
  });
  expect(Math.min(...facts.widths), `${what}: narrowest cell`).toBeGreaterThanOrEqual(
    facts.min - 0.5,
  );
  expect(facts.cut, `${what}: day numbers cut`).toEqual([]);
  expect(facts.inView, `${what}: whole days in view`).toBe(facts.days);
  expect(facts.scrolls, `${what}: the rest scrolls inside the tile`).toBe(true);
  expect(facts.monthStarts).toBeGreaterThan(0);
  return facts.days;
}

test('the strip keeps ≥ 66 px cells and whole day numbers from 360 to 1440 px, vi and en (B3, D1)', async ({
  page,
}) => {
  test.slow();
  const api = await server.api();
  await writeFixture(api);
  const seen: Record<string, number> = {};
  for (const language of ['vi', 'en'] as const) {
    await api.send('PUT', '/api/settings', { ui: { language } });
    for (const width of [360, 600, 720, 960, 1024, 1100, 1200, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${server.origin}/`);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      seen[`${language} ${width}`] = await expectReadableStrip(page, `${language} ${width}`);
      await expectNoSidewaysScroll(page, `strip ${language} ${width}`);
    }
  }
  // More room, more days; 14 at 1440, fewer than 7 on a phone.
  expect(seen['vi 1440']).toBe(14);
  expect(seen['vi 360']).toBeLessThan(7);
  expect(seen['vi 960']!).toBeLessThan(seen['vi 1200']!);
  await page.setViewportSize({ width: 960, height: 900 });
  await page.goto(`${server.origin}/`);
  await shot(page, 'bento-strip-960-en');
});

test('a busy day: "Hôm nay" shows five rows and "Xem tất cả n việc", no tile beside it stretches (B11)', async ({
  page,
}) => {
  const api = await server.api();
  await writeFixture(api);
  await createNote(
    api,
    '1 Projects/Tuần thi.md',
    `# Tuần thi\n\n${Array.from({ length: 7 }, (_, i) => `- [ ] Việc thi ${i + 1} 📅 ${T}`).join('\n')}\n`,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${server.origin}/`);
  const tasks = tile(page, 'Hôm nay');
  await expect(tasks.locator('.today-tile__meta')).toHaveText('0/10 xong');
  await expect(tasks.locator('.today-task')).toHaveCount(5);
  await expect(tasks.getByRole('link', { name: 'Xem tất cả 10 việc' })).toBeVisible();
  // The neighbours keep their content height: no large empty box under their content.
  const empty = await page.evaluate(() =>
    ['projects', 'brain', 'capture', 'writing'].map((kind) => {
      const el = document.querySelector<HTMLElement>(`.today-tile--${kind}`)!;
      const bottom = Math.max(
        ...[...el.children].map((child) => child.getBoundingClientRect().bottom),
      );
      return Math.round(el.getBoundingClientRect().bottom - bottom);
    }),
  );
  for (const gap of empty) expect(gap, `empty space ${empty.join(', ')}`).toBeLessThan(150);
  await tasks.getByRole('link', { name: 'Xem tất cả 10 việc' }).click();
  await expect(page).toHaveURL(/#\/tasks$/);
  await page.goBack();
  await shot(page, 'bento-today-busy-1440');
});
