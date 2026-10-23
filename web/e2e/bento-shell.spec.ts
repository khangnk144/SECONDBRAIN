/// <reference lib="dom" />
// The Bento frame in a real browser (F35.1–F35.3, F35.5, F35.7) on the sample vault: the rail's
// names, tooltips and aria-current per route; the "Thư mục" drawer (focus in, Esc, focus back, a
// note opened from it closes it); the folder pane beside the rail on note routes with Alt+1
// remembered after a reload; the top bar's search and "Ghi chú mới"; the style switch in
// Settings without a reload; every screen without console errors, sideways scroll or a second
// primary button at 1280 and 960 px; and S3a (write, link, backlinks) in Bento.
import { expect, test, type Page } from '@playwright/test';
import { createSampleData } from './helpers/app-api.js';
import {
  collectConsoleErrors,
  createNote,
  expectNoSidewaysScroll,
  mainNav,
  readVault,
  tokenColor,
  visiblePrimaries,
} from './helpers/m5-app.js';
import { meltedButtons, nonBentoCheckboxes } from './helpers/bento-look.js';
import { caretToEnd, noteBody, noteHash, noteTitle } from './helpers/note-page.js';
import { ownServer, type OwnServer } from './helpers/own-server.js';
import { shot } from './helpers/screenshots.js';

let server: OwnServer;
test.beforeEach(async () => {
  server = ownServer(47691, { style: 'bento' });
  await server.start();
  await createSampleData(await server.api());
});
test.afterEach(async () => server.dispose());

const PROJECT = '1 Projects/Đồ án Giải tích.md';
const PDF = '3 Resources/papers/learning-analytics-survey.pdf';

/** Rail places: route, full name (accessible name and tooltip), short label. */
const PLACES = [
  ['', 'Hôm nay', 'Hôm nay'],
  ['#/tasks', 'Việc cần làm', 'Việc'],
  ['#/calendar', 'Lịch', 'Lịch'],
  ['#/graph', 'Bản đồ não', 'Não'],
  ['#/ask', 'Hỏi AI', 'Hỏi AI'],
  ['#/resources', 'Tài liệu', 'Tài liệu'],
  ['#/tags', 'Thẻ', 'Thẻ'],
  ['#/reminders', 'Nhắc nhở', 'Nhắc nhở'],
] as const;

const folderButton = (page: Page) => mainNav(page).getByRole('button', { name: 'Thư mục' });

test('the rail: places in order, short labels, full names, tooltips, aria-current (F35.2)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${server.origin}/`);
  const rail = mainNav(page);
  await expect(rail).toHaveClass(/rail/);
  const entries = rail.locator('.rail-item');
  await expect(entries).toHaveCount(10);
  const seen = await entries.evaluateAll((list) =>
    list.map((el) => ({
      name: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      label: el.querySelector('.rail-item__label')?.textContent,
      icon: Math.round(el.querySelector('svg')!.getBoundingClientRect().width),
    })),
  );
  expect(seen.slice(0, 8)).toEqual(
    PLACES.map(([, name, label]) => ({ name, title: name, label, icon: 20 })),
  );
  expect(seen[8]).toMatchObject({ label: 'Thư mục', title: 'Thư mục (Alt+1)' });
  expect(seen[9]).toMatchObject({ name: 'Cài đặt', label: 'Cài đặt' });
  const sizes = await rail.evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    label: getComputedStyle(el.querySelector('.rail-item__label')!).fontSize,
    radius: getComputedStyle(el).borderRadius,
  }));
  expect(sizes).toEqual({ width: 84, label: '10.5px', radius: '26px' });

  const wash = await tokenColor(page, '--accent-wash');
  for (const [hash, name] of [...PLACES, ['#/settings', 'Cài đặt', 'Cài đặt'] as const]) {
    await page.goto(`${server.origin}/${hash}`);
    const current = rail.locator('[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAccessibleName(name);
    // (polled: the wash fades in with a short transition)
    await expect
      .poll(() => current.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe(wash);
  }
  // A note is no place of the rail: nothing is current.
  await page.goto(`${server.origin}/${noteHash(PROJECT)}`);
  await expect(noteTitle(page)).toHaveValue('Đồ án Giải tích');
  await expect(rail.locator('[aria-current="page"]')).toHaveCount(0);
});

test('"Thư mục" off note routes is a drawer: focus in, Esc, focus back; a note opened closes it (F35.2)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const hash of ['#/calendar', '#/graph', '']) {
    await page.goto(`${server.origin}/${hash}`);
    await expect(page.getByRole('complementary', { name: 'Thư mục' })).toHaveCount(0);
    await folderButton(page).click();
    const drawer = page.getByRole('dialog', { name: 'Thư mục' });
    await expect(drawer).toBeVisible();
    await expect(folderButton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect
      .poll(() => drawer.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);
    await expect(drawer.getByRole('tree')).toBeVisible();
    // Tab stays inside.
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab');
    expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(folderButton(page)).toBeFocused();
  }
  // On Today: open a note from the drawer; the drawer goes and the editor has focus.
  await folderButton(page).click();
  const drawer = page.getByRole('dialog', { name: 'Thư mục' });
  await drawer.getByRole('treeitem', { name: 'Sách cần mượn' }).click();
  await expect(drawer).toHaveCount(0);
  await expect(noteTitle(page)).toHaveValue('Sách cần mượn');
  await expect(noteBody(page)).toBeFocused();
});

test('the folder pane beside the rail on note routes; Alt+1 hides it and a reload remembers (F35.2)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${server.origin}/${noteHash(PROJECT)}`);
  const pane = page.getByRole('complementary', { name: 'Thư mục' });
  await expect(pane).toBeVisible();
  await expect(pane.getByRole('treeitem', { name: /^0 Inbox/ })).toContainText('2');
  expect(await pane.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(260);
  await expect(page.getByRole('complementary', { name: 'Ngăn bên phải' })).toBeVisible();
  await expect(noteBody(page)).toBeVisible();
  await page.keyboard.press('Alt+1');
  await expect(pane).toHaveCount(0);
  await expect(folderButton(page)).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(noteTitle(page)).toHaveValue('Đồ án Giải tích');
  await expect(pane).toHaveCount(0);
  await page.keyboard.press('Alt+1');
  await expect(pane).toBeVisible();
  // The PDF viewer is a file route: the pane is there too.
  await page.goto(`${server.origin}/#/file?path=${encodeURIComponent(PDF)}`);
  await expect(pane).toBeVisible();
  await shot(page, 'bento-note-1440');
  // 960–1199 px: the note keeps its room, "Thư mục" opens the drawer instead.
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(`${server.origin}/${noteHash(PROJECT)}`);
  await expect(noteTitle(page)).toHaveValue('Đồ án Giải tích');
  await expect(pane).toHaveCount(0);
  await folderButton(page).click();
  await expect(page.getByRole('dialog', { name: 'Thư mục' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expectNoSidewaysScroll(page, 'note at 1100');
});

test('top bar: the search opens the palette; "Ghi chú mới" makes a note like Alt+N (F35.3)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${server.origin}/`);
  const search = page.getByRole('button', { name: 'Tìm ghi chú hoặc hỏi AI' });
  const look = await search.evaluate((el) => ({
    h: el.getBoundingClientRect().height,
    radius: getComputedStyle(el).borderRadius,
    hint: el.querySelector('kbd')?.textContent,
  }));
  expect(look).toEqual({ h: 46, radius: '16px', hint: 'Ctrl K' });
  await search.click();
  const input = page.getByRole('combobox', { name: 'Tìm ghi chú' });
  await expect(input).toBeFocused();
  await page.keyboard.type('giai tich');
  await expect(page.locator('.palette-option__title').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);

  const newNote = page.getByRole('button', { name: 'Ghi chú mới' });
  const primary = await newNote.evaluate((el) => ({
    h: el.getBoundingClientRect().height,
    radius: getComputedStyle(el).borderRadius,
    weight: getComputedStyle(el).fontWeight,
    primary: el.classList.contains('button--primary'),
  }));
  expect(primary).toEqual({ h: 46, radius: '16px', weight: '600', primary: true });
  await newNote.click();
  await page.getByRole('listbox').getByRole('option', { name: /^Note/ }).click();
  await expect(noteTitle(page)).toBeFocused();
  await page.keyboard.type('Ghi chú từ thanh trên');
  await page.keyboard.press('Enter');
  await expect(noteBody(page)).toBeFocused();
  await expect
    .poll(() => readVault(server, '0 Inbox/Ghi chú từ thanh trên.md'))
    .toMatch(/^---\ntype: note/);
});

test('Settings → Giao diện → Phong cách: Bento ↔ Yên tĩnh at once, kept after a reload (F35.1)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${server.origin}/#/settings`);
  await page.evaluate(() => ((window as unknown as { __same: boolean }).__same = true));
  const style = page.getByRole('group', { name: 'Phong cách' });
  await expect(style.getByRole('radio', { name: 'Bento mềm' })).toBeChecked();
  await style.getByRole('radio', { name: 'Yên tĩnh' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-style', 'calm');
  await expect(page.locator('.rail')).toHaveCount(0);
  await expect(mainNav(page)).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Thư mục' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __same?: boolean }).__same)).toBe(true);
  await expect
    .poll(
      async () =>
        (await (await server.api()).get<{ ui: { style: string } }>('/api/settings')).ui.style,
    )
    .toBe('calm');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-style', 'calm');
  await expect(page.locator('.rail')).toHaveCount(0);
  await style.getByRole('radio', { name: 'Bento mềm' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-style', 'bento');
  await expect(page.locator('.rail')).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-style', 'bento');
});

test('the style radios keep keyboard focus while the frame changes (B10)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${server.origin}/#/settings`);
  const style = page.getByRole('group', { name: 'Phong cách' });
  await style.getByRole('radio', { name: 'Bento mềm' }).focus();
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement | null;
      return el?.name ? `${el.name}=${el.value}` : (el?.tagName ?? null);
    });
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('html')).toHaveAttribute('data-style', 'calm');
  await expect(page.locator('.rail')).toHaveCount(0);
  await expect.poll(focused).toBe('settings-style=calm');
  // The next key is not lost: back to Bento, focus still on the radio.
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('html')).toHaveAttribute('data-style', 'bento');
  await expect(page.locator('.rail')).toBeVisible();
  await expect.poll(focused).toBe('settings-style=bento');
  await expect(style.getByRole('radio', { name: 'Bento mềm' })).toBeChecked();
});

test('601–959 px: "Thư mục" and "Cài đặt" stay in the rail row; the places scroll, also by wheel (B8)', async ({
  page,
}) => {
  for (const width of [601, 640, 680, 700, 800, 959]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${server.origin}/#/calendar`);
    const rail = page.locator('.rail');
    await expect(rail).toBeVisible();
    const box = (await rail.boundingBox())!;
    for (const name of ['Thư mục', 'Cài đặt']) {
      const item = (await mainNav(page)
        .getByRole(name === 'Thư mục' ? 'button' : 'link', {
          name,
          exact: true,
        })
        .boundingBox())!;
      expect(item.x, `${name} at ${width}`).toBeGreaterThanOrEqual(box.x);
      expect(item.x + item.width, `${name} at ${width}`).toBeLessThanOrEqual(
        box.x + box.width + 0.5,
      );
      expect(item.x + item.width).toBeLessThanOrEqual(width);
    }
    await expectNoSidewaysScroll(page, `rail row ${width}`);
  }
  // 601 px: the places overflow; the end fades; a vertical wheel scrolls the row, not the page.
  await page.setViewportSize({ width: 601, height: 800 });
  await page.goto(`${server.origin}/#/calendar`);
  const places = page.locator('.rail__list:not(.rail__list--bottom)');
  expect(await places.evaluate((el) => el.clientWidth), 'room for the places').toBeGreaterThan(300);
  await expect(places).toHaveAttribute('data-more-end', 'true');
  await expect(places).toHaveAttribute('data-more-start', 'false');
  const row = (await places.boundingBox())!;
  await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => places.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(places).toHaveAttribute('data-more-end', 'false');
  const reminders = (await mainNav(page)
    .getByRole('link', { name: /^Nhắc nhở/ })
    .boundingBox())!;
  expect(reminders.x + reminders.width).toBeLessThanOrEqual(row.x + row.width + 0.5);
  await shot(page, 'bento-rail-row-601');
});

for (const width of [1280, 960]) {
  test(`every screen in Bento at ${width} px: no console error, no sideways scroll, one primary (F35.5, F35.7)`, async ({
    page,
  }) => {
    test.slow();
    const errors = collectConsoleErrors(page);
    await page.setViewportSize({ width, height: 900 });
    const screens: [string, string][] = [
      ['today', ''],
      ['tasks', '#/tasks'],
      ['calendar', '#/calendar'],
      ['graph', '#/graph'],
      ['ask', '#/ask'],
      ['resources', '#/resources'],
      ['tags', '#/tags'],
      ['reminders', '#/reminders'],
      ['settings', '#/settings'],
      ['review', '#/review'],
      ['note', noteHash(PROJECT)],
      ['pdf', `#/file?path=${encodeURIComponent(PDF)}`],
    ];
    for (const [name, hash] of screens) {
      await page.goto(`${server.origin}/${hash}`);
      await expect(page.locator('#main-content')).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expectNoSidewaysScroll(page, `${name} at ${width}`);
      expect((await visiblePrimaries(page)).length, `${name}: primaries`).toBeLessThanOrEqual(1);
      expect(errors, `console errors on ${name}`).toEqual([]);
      // Secondary buttons never melt into their box (B1); every checkbox is the square (B2).
      expect(await meltedButtons(page), `${name}: buttons like plain text`).toEqual([]);
      expect(await nonBentoCheckboxes(page), `${name}: native checkboxes`).toEqual([]);
    }
    // Tiles of the other screens: radius 26, gradient border; right-panel tiles 20 apart 12.
    await page.goto(`${server.origin}/${noteHash(PROJECT)}`);
    await expect(noteTitle(page)).toHaveValue('Đồ án Giải tích');
    const note = await page
      .locator('.note-screen')
      .evaluate((el) => [getComputedStyle(el).borderRadius, getComputedStyle(el).backgroundImage]);
    expect(note[0]).toBe('26px');
    expect(note[1]).toContain('linear-gradient');
    if (width >= 1200) {
      const panel = await page
        .getByRole('complementary', { name: 'Ngăn bên phải' })
        .locator('section')
        .evaluateAll((list) =>
          list.slice(0, 3).map((el) => ({
            radius: getComputedStyle(el).borderRadius,
            top: el.getBoundingClientRect().top,
            bottom: el.getBoundingClientRect().bottom,
          })),
        );
      expect(panel.map((p) => p.radius)).toEqual(['20px', '20px', '20px']);
      expect(Math.round(panel[1]!.top - panel[0]!.bottom)).toBe(12);
    }
    await page.goto(`${server.origin}/#/settings`);
    expect(
      await page
        .locator('.settings-section')
        .first()
        .evaluate((el) => getComputedStyle(el).borderRadius),
    ).toBe('26px');
    // Sub-groups are inner boxes (--tile-2, then --tile one level deeper), no hairlines (B7).
    const groups = await page.locator('.settings-subsection').evaluateAll((list) =>
      list.map((el) => {
        const style = getComputedStyle(el);
        return {
          nested: Boolean(el.parentElement?.closest('.settings-subsection')),
          background: style.backgroundColor,
          radius: style.borderTopLeftRadius,
          borders: [style.borderTopWidth, style.borderLeftWidth].join(' '),
        };
      }),
    );
    expect(groups.length).toBeGreaterThanOrEqual(6);
    const [tile, tile2] = [await tokenColor(page, '--tile'), await tokenColor(page, '--tile-2')];
    for (const group of groups) {
      expect(group).toEqual({
        nested: group.nested,
        background: group.nested ? tile : tile2,
        radius: group.nested ? '16px' : '18px',
        borders: '0px 0px',
      });
    }
    if (width === 1280) await shot(page, 'bento-settings-1280');
  });
}

test('S3a in Bento: a lecture with a [[ link, then the course backlinks (F35.7)', async ({
  page,
}) => {
  const api = await server.api();
  await createNote(api, '2 Areas/Giải tích 2.md', '---\ntype: course\n---\n\n# Giải tích 2\n');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${server.origin}/`);
  await expect(page.getByRole('tree')).toHaveCount(0);
  await page.keyboard.press('Alt+n');
  await page
    .getByRole('listbox')
    .getByRole('option', { name: /Lecture/ })
    .click();
  await expect(noteTitle(page)).toBeFocused();
  await page.keyboard.type('Bài 1 Tích phân');
  await page.keyboard.press('Enter');
  await expect(noteBody(page)).toBeFocused();
  await caretToEnd(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Xem [[giai tich 2');
  await expect(page.getByRole('option', { name: /^Giải tích 2/ }).first()).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Enter');
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(() => readVault(server, '0 Inbox/Bài 1 Tích phân.md'))
    .toContain('Xem [[Giải tích 2]]');
  // The folder pane lists the new note in Inbox.
  await expect(
    page
      .getByRole('complementary', { name: 'Thư mục' })
      .getByRole('treeitem', { name: 'Bài 1 Tích phân' }),
  ).toBeVisible();
  await page.goto(`${server.origin}/${noteHash('2 Areas/Giải tích 2.md')}`);
  const backlinks = page
    .getByRole('complementary', { name: 'Ngăn bên phải' })
    .getByRole('region', { name: /^Liên kết đến đây/ });
  await expect(backlinks.getByRole('button', { name: /Bài 1 Tích phân/ })).toBeVisible({
    timeout: 10_000,
  });
});
