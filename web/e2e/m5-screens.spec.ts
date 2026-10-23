/// <reference lib="dom" />
// Review screenshots of the Bento style (design.md §12) on the sample vault, only when
// `SB_E2E_SHOTS=<folder>` is set: Today in Bento dark and light and in calm dark at 1440×1000,
// Bento Today at 360×740, the note screen and Settings in Bento. (The graph scrubber shot comes
// from graph-advanced.spec.ts, which has a history of several weeks.)
import { expect, test, type Page } from '@playwright/test';
import { createSampleData } from './helpers/app-api.js';
import { noteHash, noteTitle } from './helpers/note-page.js';
import { ownServer, type OwnServer } from './helpers/own-server.js';
import { shot } from './helpers/screenshots.js';

test.skip(!process.env.SB_E2E_SHOTS, 'screenshots only when SB_E2E_SHOTS is set');

let server: OwnServer;
test.beforeAll(async () => {
  server = ownServer(47698, { style: 'bento' });
  await server.start();
  await createSampleData(await server.api());
});
test.afterAll(async () => server.dispose());

async function ui(patch: Record<string, string>): Promise<void> {
  await (await server.api()).send('PUT', '/api/settings', { ui: patch });
}

/** Today after its first-paint motion has ended. */
async function today(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(`${server.origin}/`);
  await expect(page.getByRole('region', { name: 'Đồ án đang làm' })).toBeVisible();
  await page.waitForTimeout(1_200);
}

test('Today: Bento dark, Bento light, calm dark at 1440; Bento at 360', async ({ page }) => {
  await ui({ style: 'bento', theme: 'dark' });
  await today(page, 1440, 1000);
  await shot(page, 'today-bento-dark-1440');
  await ui({ theme: 'light' });
  await today(page, 1440, 1000);
  await shot(page, 'today-bento-light-1440');
  await ui({ style: 'calm', theme: 'dark' });
  await today(page, 1440, 1000);
  await shot(page, 'today-calm-dark-1440');
  await ui({ style: 'bento' });
  await today(page, 360, 740);
  await shot(page, 'today-bento-360');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(page, 'today-bento-360-bottom');
});

test('note screen and Settings in Bento at 1440', async ({ page }) => {
  await ui({ style: 'bento', theme: 'dark' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${server.origin}/${noteHash('1 Projects/Đồ án Giải tích.md')}`);
  await expect(noteTitle(page)).toHaveValue('Đồ án Giải tích');
  await page.waitForTimeout(800);
  await shot(page, 'note-bento-1440');
  await page.goto(`${server.origin}/#/settings`);
  await expect(page.getByRole('heading', { level: 1, name: 'Cài đặt' })).toBeVisible();
  await shot(page, 'settings-bento-1440');
  await page.goto(`${server.origin}/#/calendar`);
  await expect(page.getByRole('grid')).toBeVisible();
  await shot(page, 'calendar-bento-1440');
});
