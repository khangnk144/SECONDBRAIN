/// <reference lib="dom" />
// Brain map in a real browser (SPEC F16.1–F16.5) on the sample vault: GET /graph renders; hovering
// a node draws its label in the next frame; a click lights exactly its depth-1 neighbours (read
// through the side panel), a second click depth 2; a double-click opens the note; with reduced
// motion there is no intro and no drift. `?focus=` puts the chosen node at the canvas centre.
import { expect, test, type Page } from '@playwright/test';
import { appApi, createSampleData, resetVault } from './helpers/app-api.js';

test.beforeEach(async ({ page }) => {
  await createSampleData(await appApi(page));
});
test.afterEach(async ({ page }) => resetVault(await appApi(page)));

interface Graph {
  nodes: { id: string; title: string }[];
  edges: { source: string; target: string }[];
}

const FOCUS = '1 Projects/Đồ án Giải tích.md';

function neighbours(graph: Graph, ids: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const { source, target } of graph.edges) {
    if (ids.has(source) && !ids.has(target)) out.add(target);
    if (ids.has(target) && !ids.has(source)) out.add(source);
  }
  return out;
}
const titles = (graph: Graph, ids: Set<string>) =>
  graph.nodes
    .filter((n) => ids.has(n.id))
    .map((n) => n.title)
    .sort();

/** Canvas centre in page coordinates. */
async function canvasCentre(page: Page) {
  const box = (await page.locator('canvas.graph-screen__canvas').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Near-white (label ink) pixels in the band right of the canvas centre, read inside the next
 * animation frame, i.e. right after the frame the view draws in answer to the last pointer event.
 */
const labelInkNextFrame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() => {
          const canvas = document.querySelector<HTMLCanvasElement>('canvas.graph-screen__canvas')!;
          const dpr = canvas.width / canvas.getBoundingClientRect().width;
          const cx = canvas.width / 2;
          const cy = canvas.height / 2;
          const data = canvas
            .getContext('2d')!
            .getImageData(cx + 6 * dpr, cy - 9 * dpr, 140 * dpr, 18 * dpr).data;
          let ink = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i]! > 215 && data[i + 1]! > 215 && data[i + 2]! > 215) ink += 1;
          }
          resolve(ink);
        }),
      ),
  );

/** Hash of the whole canvas picture. */
const canvasPicture = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.graph-screen__canvas')!;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0;
    let painted = 0;
    for (let i = 0; i < data.length; i += 4) {
      hash = (hash * 31 + data[i]! + data[i + 1]! * 7 + data[i + 2]! * 13) | 0;
      if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) painted += 1;
    }
    return { hash, painted };
  });

test.describe('with reduced motion', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('hover label next frame, click depth 1 then 2, double-click opens (F16.3, F16.5)', async ({
    page,
  }) => {
    const graph = await (await appApi(page)).get<Graph>('/api/graph');
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
      true,
    );
    expect(graph.nodes.length).toBeGreaterThan(5);
    await page.goto(`/#/graph?focus=${encodeURIComponent(FOCUS)}`);
    const details = page.locator('.graph-details');
    await expect(details.locator('.graph-details__title')).toHaveText('Đồ án Giải tích');
    const picture = await canvasPicture(page);
    expect(picture.painted, 'GET /graph is drawn').toBeGreaterThan(500);

    // Esc clears the selection, so no label is drawn; the node now sits at the canvas centre.
    await page.keyboard.press('Escape');
    await expect(details).toHaveCount(0);
    const canvas = page.locator('canvas.graph-screen__canvas');
    const corner = (await canvas.boundingBox())!;
    await page.mouse.move(corner.x + 4, corner.y + corner.height - 4);
    const inkBefore = await labelInkNextFrame(page);
    const centre = await canvasCentre(page);
    await page.mouse.move(centre.x, centre.y);
    const inkAfter = await labelInkNextFrame(page);
    expect(await canvas.evaluate((el) => el.style.cursor)).toBe('pointer');
    expect(inkAfter - inkBefore, 'hover label drawn in the next frame').toBeGreaterThan(30);

    // Click: exactly the depth-1 neighbours; second click: depth 2.
    const selected = new Set([FOCUS]);
    const depth1 = neighbours(graph, selected);
    await page.mouse.click(centre.x, centre.y);
    await expect(details.locator('.graph-details__title')).toHaveText('Đồ án Giải tích');
    const lists = details.locator('.graph-neighbors');
    await expect(lists).toHaveCount(1);
    expect(
      (await lists.first().locator('.graph-neighbors__title').allTextContents()).sort(),
    ).toEqual(titles(graph, depth1));
    // Wait past the double-click window so the next click is a single one.
    await page.waitForTimeout(450);
    await page.mouse.click(centre.x, centre.y);
    const depth2 = neighbours(graph, new Set([...selected, ...depth1]));
    if (depth2.size > 0) {
      await expect(lists).toHaveCount(2);
      expect(
        (await lists.nth(1).locator('.graph-neighbors__title').allTextContents()).sort(),
      ).toEqual(titles(graph, depth2));
    }

    // Double-click opens the note.
    await page.waitForTimeout(450);
    await page.mouse.dblclick(centre.x, centre.y);
    await expect(page).toHaveURL(/#\/note\?path=1%20Projects%2F/);
    await expect(page.getByRole('textbox', { name: /Tiêu đề ghi chú/ })).toHaveValue(
      'Đồ án Giải tích',
    );
  });

  test('reduced motion: no intro, no drift (F16.5)', async ({ page }) => {
    await page.goto('/#/graph');
    await expect(page.locator('.graph-legend')).toBeVisible();
    await expect.poll(async () => (await canvasPicture(page)).painted).toBeGreaterThan(500);
    // Labels are measured again once the bundled font has loaded (one redraw, not motion).
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const first = await canvasPicture(page);
    await page.waitForTimeout(1_000);
    expect(await canvasPicture(page)).toEqual(first);
  });
});

test('without reduced motion the map keeps drifting (control for the test above)', async ({
  page,
}) => {
  await page.goto('/#/graph');
  await expect(page.locator('.graph-legend')).toBeVisible();
  await page.waitForTimeout(1_000); // past the 600 ms intro
  const first = await canvasPicture(page);
  await page.waitForTimeout(500);
  expect((await canvasPicture(page)).hash).not.toBe(first.hash);
});
