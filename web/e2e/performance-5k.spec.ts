/// <reference lib="dom" />
// Soft performance numbers on the generated 5k vault (SPEC §5, F8.1, F10.6, F16.1), reported, not
// asserted. Opt-in: `SB_PERF=1 npx playwright test performance` generates a vault with
// `scripts/gen-vault.ts` into a fresh temporary home and serves it from a second server on port
// 4798 (never the owner's vault, never 4747). Numbers go to the console and test-results/.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { measureGraph } from './helpers/perf-graph.js';
import {
  PERF_ORIGIN as ORIGIN,
  perfServer,
  stats,
  type PerfServer,
} from './helpers/perf-server.js';

const results: Record<string, unknown> = {};

test.skip(process.env.SB_PERF !== '1', 'set SB_PERF=1 (generates a 5k vault, second server)');
test.describe.configure({ mode: 'serial' });

let server: PerfServer | null = null;

test.beforeAll(async () => {
  test.setTimeout(420_000);
  server = perfServer();
  const gen = spawnSync('npx', ['tsx', 'scripts/gen-vault.ts', '--out', server.vaultDir], {
    encoding: 'utf8',
  });
  expect(gen.status, gen.stderr).toBe(0);
  results.serverReadyWithColdIndexMs = await server.start();
});

test.afterAll(async () => {
  server?.stop();
  const out = path.join(test.info().project.outputDir, 'perf-5k.json');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`perf-5k: ${JSON.stringify(results)}`);
});

async function openToday(page: Page) {
  await page.goto(`${ORIGIN}/`);
  await expect(page.locator('.today-strip')).toBeVisible({ timeout: 30_000 });
}

// Course and concept words of the generator, typed without diacritics.
const QUERIES = [
  'giai tich',
  'dai so',
  'xac suat',
  'vat ly',
  'kinh te',
  'lap trinh',
  'cau truc du lieu',
  'toan roi rac',
  'co so du lieu',
  'mang may tinh',
  'he dieu hanh',
  'hoc may',
  'ngon ngu',
  'thong ke',
  'nghien cuu',
  'tieng anh',
  'hoa dai cuong',
  'ky nang',
  'toi uu',
  'thi giac',
  'an toan',
  'phan tich',
  'phan mem',
  'tri tue',
  'do thi',
  'vi phan',
  'dao ham',
  'tich phan',
  'ma tran',
  'dinh thuc',
  'phan phoi chuan',
  'ky vong',
  'phuong sai',
  'hoi quy',
  'gradient',
  'attention',
  'transformer',
  'entropy',
  'markov',
  'de quy',
];

test('palette keystroke-to-results on 5k notes (F8.1)', async ({ page }) => {
  await openToday(page);
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: 'Tìm ghi chú' });
  await expect(input).toBeFocused();
  const durations: number[] = [];
  for (const query of QUERIES) {
    await page.evaluate(() => performance.clearMeasures('palette:keystroke-to-results'));
    // One input event per query: the app's measure runs from it to its results on screen.
    await input.fill(query);
    durations.push(
      await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const check = () => {
              const entries = performance.getEntriesByName('palette:keystroke-to-results');
              if (entries.length > 0) resolve(entries[entries.length - 1]!.duration);
              else setTimeout(check, 10);
            };
            check();
          }),
      ),
    );
  }
  results.paletteKeystrokeToResultsMs = stats(durations);
  results.paletteAfterDebounceMs = stats(durations.map((d) => d - 120));
});

test('Today API and render with a warm index (F10.6)', async ({ page }) => {
  await openToday(page);
  results.todayContent = {
    taskRows: await page.locator('.today .deadline-row').count(),
    projectCards: await page.locator('.project-card').count(),
  };
  const api = await page.evaluate(async () => {
    const token = document.querySelector('meta[name="sb-token"]')!.getAttribute('content')!;
    const times: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const t0 = performance.now();
      await (await fetch('/api/today', { headers: { 'X-SB-Token': token } })).json();
      times.push(performance.now() - t0);
    }
    return times;
  });
  results.todayApiRoundTripMs = stats(api);
  // Route change from Tasks to Today until the strip and the projects are on screen.
  const renders: number[] = [];
  for (let i = 0; i < 12; i += 1) {
    await page.evaluate(() => (location.hash = '#/tasks'));
    await expect(page.locator('.today-strip')).toHaveCount(0);
    renders.push(
      await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const t0 = performance.now();
            location.hash = '#/';
            const check = () => {
              const done =
                document.querySelector('.today-strip__cell') &&
                document.querySelector('.today__projects');
              if (done) resolve(performance.now() - t0);
              else requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
          }),
      ),
    );
  }
  results.todayRouteRenderMs = stats(renders);
});

test('graph layout time and fps on the 5k vault (F16.1, headless)', async ({ page }) => {
  test.setTimeout(180_000);
  results.graph5k = await measureGraph(page, ORIGIN);
});
