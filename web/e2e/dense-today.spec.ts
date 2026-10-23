/// <reference lib="dom" />
// Dense Today (SPEC F10.2): 10 items on one day, 30 overdue, 120-character titles, at 360 and
// 720 px wide and with the 16 and 18 px base font. No boxes overlap on the strip, "+n" and
// "Quá hạn (30)" show, the popovers list everything, density does not move the sections below,
// and the page never scrolls sideways. Full-page screenshots go to test-results/dense-today/.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { appApi, isoAddDays, localIso, resetVault } from './helpers/app-api.js';
import {
  DENSE_DAY_OFFSET,
  DENSE_NOTE,
  denseNoteContent,
  denseTitle,
} from './helpers/dense-fixture.js';
import { calmOnly } from './helpers/calm-only.js';

// Calm layout (`.today__summary`, `.today__pair`): the Bento dense checks are in bento-today.spec.ts.
calmOnly();

test.afterEach(async ({ page }) => resetVault(await appApi(page)));

/** Kept next to the other results, outside the per-test folders, for the lead's review. */
const shotPath = (name: string) => path.join(test.info().project.outputDir, 'dense-today', name);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Distance from the strip's top to the "Hôm nay"/"Ghi nhanh" row (independent of the summary). */
const sectionsBelowStrip = (page: Page) =>
  page.evaluate(() => {
    const strip = document.querySelector('.today-strip')!.getBoundingClientRect();
    const pair = document.querySelector('.today__pair')!.getBoundingClientRect();
    return Math.round(pair.top - strip.top);
  });

/** Every overlap problem on the strip and between the sections, as readable strings. */
function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const overlap = (a: Box, b: Box) =>
      Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 &&
      Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
    const inside = (inner: Box, outer: Box) =>
      inner.x >= outer.x - 1 &&
      inner.y >= outer.y - 1 &&
      inner.x + inner.w <= outer.x + outer.w + 1 &&
      inner.y + inner.h <= outer.y + outer.h + 1;
    const scroller = box(document.querySelector('.today-strip__scroller')!);
    const cells = [...document.querySelectorAll<HTMLElement>('.today-strip__cell')].filter((c) => {
      if (c.classList.contains('today-strip__cell--overdue')) return true;
      const b = box(c);
      return b.x + b.w > scroller.x + 1 && b.x < scroller.x + scroller.w - 1;
    });
    if (cells.length < 7) problems.push(`only ${cells.length} cells visible`);
    cells.forEach((cell, i) => {
      const cb = box(cell);
      cells.slice(i + 1).forEach((other) => {
        if (overlap(cb, box(other)))
          problems.push(`cells ${cell.dataset.key} and ${other.dataset.key} overlap`);
      });
      const parts = [
        ...cell.querySelectorAll(
          '.today-strip__heading, .today-strip__weekday, .today-strip__day, .today-strip__label, .today-strip__more',
        ),
      ].filter((el) => box(el).w > 0);
      parts.forEach((part, j) => {
        if (!inside(box(part), cb))
          problems.push(`${part.className} sticks out of cell ${cell.dataset.key}`);
        parts.slice(j + 1).forEach((other) => {
          if (overlap(box(part), box(other)))
            problems.push(
              `${part.className} and ${other.className} overlap in ${cell.dataset.key}`,
            );
        });
      });
    });
    const strip = box(document.querySelector('.today-strip')!);
    const sections = [...document.querySelectorAll('.today__section')].map(box);
    sections.forEach((s, i) => {
      if (s.y < strip.y + strip.h - 0.5) problems.push(`section ${i} starts inside the strip`);
      sections.slice(i + 1).forEach((other, k) => {
        if (overlap(s, other)) problems.push(`sections ${i} and ${i + k + 1} overlap`);
      });
    });
    return problems;
  });
}

for (const width of [360, 720]) {
  for (const fontSize of [16, 18]) {
    test(`dense Today at ${width} px, ${fontSize} px font (F10.2)`, async ({ page }) => {
      const api = await appApi(page);
      const today = localIso();
      const denseDay = isoAddDays(today, DENSE_DAY_OFFSET);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.locator('.today-strip')).toBeVisible();
      if (fontSize !== 16) {
        await page.evaluate(
          (size) => (document.documentElement.dataset.fontSize = size),
          String(fontSize),
        );
      }
      await expect(page.locator('.today__summary')).toHaveText(
        'Hôm nay không có gì gấp. Viết gì đó nhé?',
      );
      const emptyOffset = await sectionsBelowStrip(page);

      // The dense note arrives while Today is open (live refresh).
      await api.send('POST', '/api/note', { path: DENSE_NOTE, content: denseNoteContent(today) });
      const overdue = page.locator('.today-strip__cell--overdue');
      await expect(overdue.locator('.today-strip__heading')).toHaveText('Quá hạn (30)');
      await expect(overdue.locator('.today-strip__more')).toHaveText('+28');
      const dense = page.locator(`.today-strip__cell[data-key="${denseDay}"]`);
      await expect(dense.locator('.today-strip__more')).toHaveText('+8');
      await expect(dense.locator('.today-strip__label')).toHaveCount(2);
      const visibleDays = await page.locator('.today-strip').getAttribute('data-visible-days');
      if (width === 360) expect(visibleDays).toBe('7');

      expect(await layoutProblems(page)).toEqual([]);
      expect(await sectionsBelowStrip(page), 'density moves the sections below').toBe(emptyOffset);
      const scroll = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }));
      expect(scroll, 'no horizontal page scroll').toEqual({ page: 0, body: 0 });
      await page.screenshot({
        path: shotPath(`today-${width}px-${fontSize}px.png`),
        fullPage: true,
      });

      // The popovers list everything and stay inside the window.
      for (const [cell, count, kind] of [
        [dense, 10, 'ngày'],
        [overdue, 30, 'quá hạn'],
      ] as const) {
        await cell.click();
        const popover = page.locator('.today-strip__popover');
        await expect(popover.locator('li')).toHaveCount(count);
        const titles = await popover.locator('.deadline-row__title').allTextContents();
        expect(titles.sort()).toEqual(
          Array.from({ length: count }, (_, i) => denseTitle(kind, i + 1)).sort(),
        );
        const edge = await popover.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: window.innerWidth - r.right };
        });
        expect(edge.left).toBeGreaterThanOrEqual(0);
        expect(edge.right).toBeGreaterThanOrEqual(0);
        await page.screenshot({
          path: shotPath(
            `popover-${kind === 'ngày' ? 'day' : 'overdue'}-${width}px-${fontSize}px.png`,
          ),
        });
        await page.keyboard.press('Escape');
        await expect(popover).toHaveCount(0);
      }
    });
  }
}

test('the sections below keep their place while Today loads (F10.2, first paint)', async ({
  page,
}) => {
  // A placeholder with the strip's own cells holds its place (and the summary keeps one line)
  // until GET /today answers.
  const api = await appApi(page);
  await api.send('POST', '/api/note', { path: DENSE_NOTE, content: denseNoteContent(localIso()) });
  await page.setViewportSize({ width: 720, height: 900 });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/today', async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto('/');
  const pair = page.locator('.today__pair');
  await expect(pair).toBeVisible();
  await expect(page.locator('.today-strip-placeholder')).toBeVisible();
  const before = await pair.evaluate((el) => el.getBoundingClientRect().top);
  release();
  await expect(page.getByRole('group', { name: 'Các ngày tới' })).toBeVisible();
  await expect(page.locator('.today-strip-placeholder')).toHaveCount(0);
  const after = await pair.evaluate((el) => el.getBoundingClientRect().top);
  test
    .info()
    .annotations.push({ type: 'shift-px', description: String(Math.round(after - before)) });
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
});
