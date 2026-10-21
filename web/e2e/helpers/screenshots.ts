// Optional screenshots for the milestone report: set SB_E2E_SHOTS=<folder> and the specs that
// call `shot()` save PNGs there. Without the variable nothing is written.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.SB_E2E_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/**
 * The same screen at phone width too: `<name>-1280.png` and `<name>-360.png`, then the viewport
 * goes back to what it was. Nothing is resized when screenshots are off.
 */
export async function shotWide(page: Page, name: string): Promise<void> {
  if (!process.env.SB_E2E_SHOTS) return;
  const before = page.viewportSize() ?? { width: 1280, height: 720 };
  await shot(page, `${name}-1280`);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
  await shot(page, `${name}-360`);
  await page.setViewportSize(before);
}
