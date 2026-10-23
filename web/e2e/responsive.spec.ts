/// <reference lib="dom" />
// Phones and narrow windows (F28.1, F28.2, F35.5) in a real browser, both styles, on the sample
// vault: the Bento bottom tab bar with its "Thêm" sheet and the folder drawer, the calm sidebar
// behind the menu button, the right panel as a bottom sheet (focus trapped, Esc and close button,
// focus back), typing in a note at 360 px, quick capture and the palette at full width, a tap on a
// calendar day, touch targets ≥ 40 px, and no sideways page scroll from 360 to 1440 px.
import { expect, test, type Page } from '@playwright/test';
import { createSampleData } from './helpers/app-api.js';
import {
  collectConsoleErrors,
  expectNoSidewaysScroll,
  mainNav,
  readVault,
  sidewaysOverflow,
} from './helpers/m5-app.js';
import { graphOverlaysOnCanvas } from './helpers/bento-look.js';
import { newLastLine, noteHash, noteTitle } from './helpers/note-page.js';
import { ownServer, type OwnServer } from './helpers/own-server.js';
import { shot } from './helpers/screenshots.js';

type Style = 'bento' | 'calm';
let server: OwnServer;
test.beforeEach(async () => {
  server = ownServer(47692, { style: 'bento' });
  await server.start();
  await createSampleData(await server.api());
});
test.afterEach(async () => server.dispose());

// Touch emulation: `pointer: coarse`, as on a phone (the 40 px touch targets apply).
test.use({ hasTouch: true });

const PROJECT = '1 Projects/Đồ án Giải tích.md';
const PHONE = { width: 360, height: 740 };

async function useStyle(style: Style): Promise<void> {
  await (await server.api()).send('PUT', '/api/settings', { ui: { style } });
}

const insideOf = (dialog: ReturnType<Page['getByRole']>) =>
  dialog.evaluate((el) => el.contains(document.activeElement));

/** Tab a few times: focus never leaves `dialog` (F28.1 focus trap). */
async function expectTrapped(page: Page, dialog: ReturnType<Page['getByRole']>): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press(i % 4 === 3 ? 'Shift+Tab' : 'Tab');
    expect(await insideOf(dialog), `focus inside after ${i + 1} presses`).toBe(true);
  }
}

test('phones, Bento: bottom tab bar, "Thêm" sheet, folder drawer, 40 px targets (F28.1)', async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto(`${server.origin}/`);
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  const bar = mainNav(page);
  await expect(bar).toHaveClass(/bottom-bar/);
  const items = bar.locator('.rail-item');
  await expect(items).toHaveCount(5);
  expect(
    await items.evaluateAll((list) =>
      list.map((el) => el.querySelector('.rail-item__label')?.textContent),
    ),
  ).toEqual(['Hôm nay', 'Việc', 'Lịch', 'Ghi nhanh', 'Thêm']);
  const geometry = await bar.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const sizes = [...el.querySelectorAll('.rail-item')].map((item) => {
      const b = item.getBoundingClientRect();
      return Math.min(b.width, b.height);
    });
    return { bottom: Math.round(window.innerHeight - r.bottom), smallest: Math.min(...sizes) };
  });
  expect(geometry.bottom).toBeLessThanOrEqual(20);
  expect(geometry.smallest).toBeGreaterThanOrEqual(40);
  await shot(page, 'bento-today-360');

  // "Thêm": every other place, Thư mục and Cài đặt; focus trapped; Esc gives focus back.
  const more = bar.getByRole('button', { name: 'Thêm mục khác' });
  await more.click();
  const sheet = page.getByRole('dialog', { name: 'Thêm' });
  await expect(sheet).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  expect(
    await sheet
      .locator('.rail-item')
      .evaluateAll((list) => list.map((el) => el.querySelector('.rail-item__label')?.textContent)),
  ).toEqual(['Não', 'Hỏi AI', 'Tài liệu', 'Thẻ', 'Nhắc nhở', 'Thư mục', 'Cài đặt']);
  await expectTrapped(page, sheet);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(more).toBeFocused();

  // A place chosen in the sheet navigates and closes it.
  await more.click();
  await sheet.getByRole('link', { name: 'Thẻ' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/#\/tags$/);

  // Thư mục from "Thêm": the folder drawer, 40 px tree rows; a note opened closes it.
  await more.click();
  await sheet.getByRole('button', { name: 'Thư mục' }).click();
  const drawer = page.getByRole('dialog', { name: 'Thư mục' });
  await expect(drawer).toBeVisible();
  const rowHeight = await drawer
    .getByRole('treeitem')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(rowHeight).toBeGreaterThanOrEqual(40);
  const drawerWidth = await drawer.evaluate((el) => el.getBoundingClientRect().right);
  expect(drawerWidth).toBeLessThanOrEqual(PHONE.width);
  await drawer.getByRole('treeitem', { name: 'Sách cần mượn' }).click();
  await expect(drawer).toHaveCount(0);
  await expect(noteTitle(page)).toHaveValue('Sách cần mượn');
  await expectNoSidewaysScroll(page, 'bento note 360');
});

test('phones, calm: the sidebar is a drawer behind the menu button (F28.1)', async ({ page }) => {
  await useStyle('calm');
  await page.setViewportSize(PHONE);
  await page.goto(`${server.origin}/`);
  await expect(page.locator('html')).toHaveAttribute('data-style', 'calm');
  await expect(mainNav(page)).toHaveCount(0);
  const menu = page.getByRole('button', { name: 'Điều hướng và thư mục' });
  await menu.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  await expect(drawer.getByRole('tree', { name: 'Thư mục' })).toBeVisible();
  // The tree has its height in the drawer (it was 0 px high, review B9): a folder is there to
  // see and tap, and a note opens from it.
  const inbox = drawer.getByRole('treeitem', { name: /^\d+ Inbox/ });
  await inbox.scrollIntoViewIfNeeded();
  await expect(inbox).toBeInViewport();
  const tree = await drawer
    .getByRole('tree', { name: 'Thư mục' })
    .evaluate((el) => el.closest('.sidebar-folders')!.getBoundingClientRect().height);
  expect(tree).toBeGreaterThan(200);
  await expectTrapped(page, drawer);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(menu).toBeFocused();
  await menu.click();
  await drawer.getByRole('link', { name: 'Lịch' }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(/#\/calendar$/);
  await expectNoSidewaysScroll(page, 'calm calendar 360');
  // A note opened from the drawer's tree (Projects is expanded by default).
  await menu.click();
  const project = drawer.getByRole('treeitem', { name: 'Đồ án Giải tích' });
  await project.scrollIntoViewIfNeeded();
  await project.click();
  await expect(noteTitle(page)).toHaveValue('Đồ án Giải tích');
  await expect(drawer).toHaveCount(0);
});

for (const style of ['bento', 'calm'] as const) {
  test(`${style}: the brain map on phones keeps its filters, scrubber and legend off the canvas (B6)`, async ({
    page,
  }) => {
    await useStyle(style);
    for (const width of [360, 600]) {
      await page.setViewportSize({ width, height: 740 });
      await page.goto(`${server.origin}/#/graph`);
      await expect(page.locator('.graph-filters')).toBeVisible();
      await expect(page.locator('.graph-time')).toBeVisible();
      const canvas = (await page.locator('.graph-screen__canvas').boundingBox())!;
      expect(canvas.height, `canvas at ${width}`).toBeGreaterThanOrEqual(300);
      expect(await graphOverlaysOnCanvas(page), `overlays on the canvas at ${width}`).toEqual([]);
      await expectNoSidewaysScroll(page, `${style} graph ${width}`);
    }
    // Wider windows keep the overlays on the map as before.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${server.origin}/#/graph`);
    await expect(page.locator('.graph-filters')).toBeVisible();
    expect(await graphOverlaysOnCanvas(page)).not.toEqual([]);
    await page.setViewportSize({ width: 360, height: 740 });
    await shot(page, `${style}-graph-360`);
  });
}

for (const style of ['bento', 'calm'] as const) {
  test(`phones, ${style}: Today, typing in a note, right-panel sheet, capture, palette (F28.2)`, async ({
    page,
  }) => {
    test.slow();
    await useStyle(style);
    const errors = collectConsoleErrors(page);
    await page.setViewportSize(PHONE);
    await page.goto(`${server.origin}/`);
    await expect(page.getByRole('region', { name: 'Đồ án đang làm' })).toBeVisible();
    await expectNoSidewaysScroll(page, `${style} Today 360`);

    // Read and type in a note.
    await page.goto(`${server.origin}/${noteHash(PROJECT)}`);
    await expect(noteTitle(page)).toHaveValue('Đồ án Giải tích');
    await newLastLine(page);
    await page.keyboard.type('Gõ trên điện thoại vẫn lưu được');
    await expect
      .poll(() => readVault(server, PROJECT), { timeout: 10_000 })
      .toContain('Gõ trên điện thoại vẫn lưu được');
    await expectNoSidewaysScroll(page, `${style} note 360`);

    // The right panel is a bottom sheet behind its toggle: focus trapped, close button, Esc.
    await expect(page.getByRole('complementary', { name: 'Ngăn bên phải' })).toHaveCount(0);
    const toggle = page.getByRole('button', { name: 'Mở ngăn phải' });
    await toggle.click();
    const sheet = page.getByRole('dialog', { name: 'Ngăn bên phải' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('region', { name: /^Liên kết đến đây/ })).toBeVisible();
    const sheetBox = await sheet.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        right: window.innerWidth - r.right,
        bottom: window.innerHeight - r.bottom,
      };
    });
    expect(sheetBox.left).toBeGreaterThanOrEqual(0);
    expect(sheetBox.right).toBeGreaterThanOrEqual(0);
    await expect.poll(() => insideOf(sheet)).toBe(true);
    await expectTrapped(page, sheet);
    await sheet.getByRole('button', { name: 'Đóng' }).first().click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mở ngăn phải' })).toBeFocused();
    await page.getByRole('button', { name: 'Mở ngăn phải' }).click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mở ngăn phải' })).toBeFocused();

    // Quick capture: full width (12 px margins), Enter saves into Inbox.
    await page.goto(`${server.origin}/`);
    await expect(page.getByRole('region', { name: 'Đồ án đang làm' })).toBeVisible();
    if (style === 'bento')
      await mainNav(page).getByRole('button', { name: 'Ghi nhanh vào Inbox' }).click();
    else {
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('Alt+q');
    }
    const capture = page.getByRole('dialog', { name: 'Ghi nhanh' });
    await expect(capture).toBeVisible();
    const width = await capture.evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThanOrEqual(PHONE.width - 24 - 1);
    await page.keyboard.type(`Ý từ điện thoại ${style}`);
    await page.keyboard.press('Enter');
    await expect(capture).toHaveCount(0);
    await expect
      .poll(() => readVault(server, `0 Inbox/Ý từ điện thoại ${style}.md`))
      .toContain(`Ý từ điện thoại ${style}`);

    // The palette: full width, a search and Enter opens the note.
    await page.keyboard.press('Control+k');
    const input = page.getByRole('combobox', { name: 'Tìm ghi chú' });
    await expect(input).toBeFocused();
    const palette = await input.evaluate((el) => {
      const box = el.closest('[role="dialog"]')!.getBoundingClientRect();
      return { left: box.left, right: window.innerWidth - box.right };
    });
    expect(palette.left).toBeGreaterThanOrEqual(0);
    expect(palette.left).toBeLessThanOrEqual(16);
    expect(palette.right).toBeGreaterThanOrEqual(0);
    expect(palette.right).toBeLessThanOrEqual(16);
    const answered = page.waitForResponse((r) => r.url().includes('/api/search'));
    await page.keyboard.type('xac suat thong ke');
    await answered;
    await expect(page.locator('.palette-option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(noteTitle(page)).toHaveValue('Xác suất thống kê');
    await expectNoSidewaysScroll(page, `${style} note after palette 360`);
    await shot(page, `${style}-note-360`);
    expect(errors).toEqual([]);
  });

  test(`phones, ${style}: a tap on a calendar day opens the day in the bottom sheet (F28.1)`, async ({
    page,
  }) => {
    await useStyle(style);
    await page.setViewportSize(PHONE);
    await page.goto(`${server.origin}/#/calendar`);
    const tomorrow = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    });
    const cell = page.locator(`[role="gridcell"][data-date="${tomorrow}"]`);
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    const sheet = page.getByRole('dialog', { name: 'Ngăn bên phải' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('checkbox', { name: 'Giải 10 bài tập mẫu' })).toBeVisible();
    await expectNoSidewaysScroll(page, `${style} calendar sheet 360`);
  });

  test(`${style}: no sideways page scroll from 360 to 1440 px (F35.5, F28.2)`, async ({ page }) => {
    test.slow();
    await useStyle(style);
    const screens: [string, string][] = [
      ['today', ''],
      ['note', noteHash(PROJECT)],
      ['calendar', '#/calendar'],
      ['settings', '#/settings'],
    ];
    const problems: string[] = [];
    for (const width of [360, 600, 720, 960, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const extra: [string, string][] =
        width === 360
          ? [
              ['graph', '#/graph'],
              ['review', '#/review'],
              ['tasks', '#/tasks'],
            ]
          : [];
      for (const [name, hash] of [...screens, ...extra]) {
        await page.goto(`${server.origin}/${hash}`);
        await expect(page.locator('#main-content')).toBeVisible();
        await page.waitForLoadState('networkidle');
        const overflow = await sidewaysOverflow(page);
        if (overflow.page > 0 || overflow.body > 0) {
          problems.push(`${name} at ${width}: ${JSON.stringify(overflow)}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
}
