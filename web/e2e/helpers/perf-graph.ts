/// <reference lib="dom" />
// Graph timing in the browser: from the `/api/graph` answer to the first drawn map (layout
// included), then the `?debug=fps` overlay read once a second for 10 s after settling.
import { expect, type Page } from '@playwright/test';

export async function measureGraph(page: Page, origin: string) {
  await page.goto(`${origin}/#/tasks`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
  const graphResponse = page.waitForResponse((r) => r.url().endsWith('/api/graph'), {
    timeout: 60_000,
  });
  await page.evaluate(() => (location.hash = '#/graph?debug=fps'));
  const response = await graphResponse;
  const answered = Date.now();
  const body = (await response.json()) as { nodes: unknown[]; edges: unknown[] };
  await expect(page.getByText('Đang vẽ bản đồ não…')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('.graph-legend')).toBeVisible();
  const drawnMs = Date.now() - answered;
  await page.waitForTimeout(3_000); // intro and live settling
  const fps: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    await page.waitForTimeout(1_000);
    const value = await page.locator('[data-graph-fps]').getAttribute('data-graph-fps');
    if (value !== null) fps.push(Number(value));
  }
  return {
    nodes: body.nodes.length,
    edges: body.edges.length,
    responseToDrawnMs: drawnMs,
    fps10s: {
      samples: fps,
      min: Math.min(...fps),
      avg: Math.round(fps.reduce((a, b) => a + b, 0) / fps.length),
    },
  };
}
