/// <reference lib="dom" />
// "Tổng kết tuần" (F26.1–F26.3) in a real browser with the browser clock mocked: hidden on
// Saturday 23:59, shown from Sunday 00:00 (the card follows the clock without a reload), gone on
// Monday; counts equal a scan of the fixture and the API; up to 8 notes and "Xem tất cả"; "Để sau"
// hides it until the next Sunday (also after a reload); a Bento tile after the strip and a calm
// section before it; "Dọn Inbox" without AI opens the folder tree at Inbox; `#/review` any day
// with its week steps; the palette command.
import { expect, test, type Page } from '@playwright/test';
import { isoAddDays, localIso, type AppApi } from './helpers/app-api.js';
import { meltedButtons } from './helpers/bento-look.js';
import { createNote, mainNav } from './helpers/m5-app.js';
import { ownServer, type OwnServer } from './helpers/own-server.js';

let server: OwnServer;
test.beforeEach(async () => {
  server = ownServer(47694, { style: 'bento' });
  await server.start();
});
test.afterEach(async () => server.dispose());

const T = localIso();
/** The Sunday that ends this week (the notes written now fall in its seven days). */
const SUNDAY = isoAddDays(T, (7 - new Date().getDay()) % 7);

/** Local time `HH:mm:ss` on `iso`. */
function at(iso: string, time: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const [hh, mm, ss] = time.split(':').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, hh, mm, ss);
}

/** 2 Inbox notes, 8 more notes, a project with 2 tasks done now and 2 deadlines next week. */
async function writeFixture(api: AppApi): Promise<void> {
  await createNote(api, '0 Inbox/Ý tưởng A.md', '# Ý tưởng A\n');
  await createNote(api, '0 Inbox/Ý tưởng B.md', '# Ý tưởng B\n');
  for (let i = 1; i <= 8; i += 1) {
    await createNote(api, `2 Areas/Ghi chép tuần ${i}.md`, `# Ghi chép tuần ${i}\n`);
  }
  await createNote(
    api,
    '1 Projects/Đồ án tuần.md',
    `---\ntype: project\nstatus: doing\ndeadline: ${isoAddDays(SUNDAY, 5)}\n---\n\n# Đồ án tuần\n\n` +
      `- [x] Viết mở đầu ✅ ${T}\n- [x] Sửa lỗi chính tả ✅ ${T}\n` +
      `- [ ] Nộp bản thảo 📅 ${isoAddDays(SUNDAY, 3)}\n`,
  );
}

const card = (page: Page) => page.getByRole('region', { name: 'Tổng kết tuần' });

async function expectCounts(page: Page): Promise<void> {
  const review = card(page);
  await expect(review.getByText('Inbox có 2 ghi chú.')).toBeVisible();
  await expect(review.getByText('Bạn đã tạo hoặc sửa 11 ghi chú.')).toBeVisible();
  await expect(review.getByText('Bạn đã xong 2 việc.')).toBeVisible();
  await expect(review.getByText('Tuần tới có 2 deadline.')).toBeVisible();
}

test('Saturday 23:59 → Sunday 00:00 → Monday; counts; "Để sau" until next Sunday (F26.1–F26.3)', async ({
  page,
}) => {
  test.slow();
  const api = await server.api();
  await writeFixture(api);
  // The server's scan of the same fixture (the card shows its numbers).
  const week = await api.get<{
    start: string;
    inbox: { count: number };
    notes: { count: number };
    tasksDone: { count: number };
    upcoming: { count: number };
  }>(`/api/review/week?end=${SUNDAY}`);
  expect(week).toMatchObject({
    start: isoAddDays(SUNDAY, -6),
    inbox: { count: 2 },
    notes: { count: 11 },
    tasksDone: { count: 2 },
    upcoming: { count: 2 },
  });

  await page.clock.install({ time: at(isoAddDays(SUNDAY, -1), '23:59:30') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${server.origin}/`);
  await expect(page.getByRole('region', { name: 'Hôm nay', exact: true })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  // Midnight passes while Today is open: the card comes.
  await page.clock.fastForward('01:00');
  await expect(card(page)).toBeVisible();
  await expectCounts(page);
  // Bento: a full-width tile between the strip and "Hôm nay", 8 notes listed, "Xem tất cả".
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('.today-bento__grid > *')].map((el) =>
      el.classList.contains('today-bento__review')
        ? 'review'
        : (el.className.match(/today-tile--(\w+)/)?.[1] ?? '?'),
    ),
  );
  expect(order.slice(3, 6)).toEqual(['strip', 'review', 'tasks']);
  const widths = await page.evaluate(() => ({
    review: document.querySelector('.weekly-review')!.getBoundingClientRect().width,
    strip: document.querySelector('.today-tile--strip')!.getBoundingClientRect().width,
  }));
  expect(Math.abs(widths.review - widths.strip)).toBeLessThanOrEqual(1);
  await expect(card(page)).toHaveClass(/tile/);
  const notes = card(page).getByRole('region', { name: 'Ghi chép' });
  await expect(notes.locator('.weekly-review__item')).toHaveCount(8);
  await expect(notes.getByRole('link', { name: 'Xem tất cả' })).toBeVisible();

  // "Để sau": a toast, the card goes, focus stays in the page; a reload keeps it hidden.
  await card(page).getByRole('button', { name: 'Để sau' }).click();
  await expect(
    page.getByText('Đã ẩn tổng kết tuần đến Chủ nhật sau. Bảng lệnh vẫn mở được nó.'),
  ).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Hôm nay', exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(card(page)).toHaveCount(0);

  // Monday: not shown (dismissal aside). The next Sunday: back.
  await page.clock.setSystemTime(at(isoAddDays(SUNDAY, 1), '00:00:30'));
  await page.reload();
  await expect(page.getByRole('region', { name: 'Hôm nay', exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(card(page)).toHaveCount(0);
  await page.clock.setSystemTime(at(isoAddDays(SUNDAY, 7), '09:00:00'));
  await page.reload();
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByText('Inbox có 2 ghi chú.')).toBeVisible();
});

test('calm: a quiet section after the summary, before the strip; "Dọn Inbox" opens the tree at Inbox (F26.1)', async ({
  page,
}) => {
  const api = await server.api();
  await writeFixture(api);
  await api.send('PUT', '/api/settings', { ui: { style: 'calm' } });
  await page.clock.install({ time: at(SUNDAY, '10:00:00') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${server.origin}/`);
  await expect(card(page)).toBeVisible();
  await expectCounts(page);
  await expect(card(page)).not.toHaveClass(/\btile\b/);
  const before = await page.evaluate(() => {
    const review = document.querySelector('.weekly-review')!;
    const strip = document.querySelector('.today-strip')!;
    const summary = document.querySelector('.today__summary')!;
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { afterSummary: follows(summary, review), beforeStrip: follows(review, strip) };
  });
  expect(before).toEqual({ afterSummary: true, beforeStrip: true });
  // Without in-app AI, "Dọn Inbox" says what it does and opens the folder tree at Inbox.
  const tidy = card(page).getByRole('button', { name: 'Dọn Inbox' });
  await expect(tidy).toHaveAccessibleDescription(
    'Mở cây thư mục ở Inbox để bạn xếp các ghi chú vào thư mục.',
  );
  await tidy.click();
  const inbox = page
    .getByRole('tree', { name: 'Thư mục' })
    .getByRole('treeitem', { name: /^0 Inbox/ });
  await expect(inbox).toHaveAttribute('aria-expanded', 'true');
  await expect(inbox).toBeFocused();
  await expect(page.getByRole('treeitem', { name: 'Ý tưởng A' })).toBeVisible();
});

test('Bento: "Dọn Inbox" opens the folder drawer at Inbox (F26.1)', async ({ page }) => {
  await writeFixture(await server.api());
  await page.clock.install({ time: at(SUNDAY, '10:00:00') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${server.origin}/`);
  await expect(card(page).getByRole('button', { name: 'Dọn Inbox' })).toBeVisible();
  // On its --tile-2 box the button keeps a surface of its own (review B1), in dark and light.
  expect(await meltedButtons(page)).toEqual([]);
  await (await server.api()).send('PUT', '/api/settings', { ui: { theme: 'light' } });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await meltedButtons(page)).toEqual([]);
  await card(page).getByRole('button', { name: 'Dọn Inbox' }).click();
  const drawer = page.getByRole('dialog', { name: 'Thư mục' });
  await expect(drawer).toBeVisible();
  const inbox = drawer.getByRole('treeitem', { name: /^0 Inbox/ });
  await expect(inbox).toHaveAttribute('aria-expanded', 'true');
  await expect(inbox).toBeFocused();
});

test('#/review any day, week steps, and the palette command "Tổng kết tuần" (F26.2)', async ({
  page,
}) => {
  await writeFixture(await server.api());
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${server.origin}/`);
  await expect(mainNav(page)).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('>tổng kết');
  await expect(page.locator('.palette-option').first()).toContainText('Tổng kết tuần');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/review/);
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng kết tuần' })).toBeVisible();
  // The week ending today (any weekday).
  await expect(page.getByText('Inbox có 2 ghi chú.')).toBeVisible();
  await expect(page.getByText('Bạn đã tạo hoặc sửa 11 ghi chú.')).toBeVisible();
  // All eleven notes are listed here.
  await expect(
    page.getByRole('region', { name: 'Ghi chép' }).locator('.weekly-review__item'),
  ).toHaveCount(11);
  const next = page.getByRole('button', { name: 'Tuần sau' });
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('button', { name: 'Tuần trước' }).click();
  await expect(page).toHaveURL(new RegExp(`end=${isoAddDays(T, -7)}`));
  await expect(page.getByText('Tuần này chưa có ghi chú nào. Viết vài dòng nhé?')).toBeVisible();
  await page.getByRole('button', { name: 'Về tuần này' }).click();
  await expect(page.getByText('Bạn đã tạo hoặc sửa 11 ghi chú.')).toBeVisible();
});
