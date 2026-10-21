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
