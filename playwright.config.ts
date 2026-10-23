// End-to-end tests against the built app (run `npm run build` first; `npm run test:e2e` does).
// The server gets a fresh temporary home (with spaces and Vietnamese letters in its path), so the
// owner's real settings and vault are never touched.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { seedStyle } from './web/e2e/helpers/e2e-style.js';

const port = 4799;
// The config is loaded by the runner and by every worker; the env var keeps one home per run.
// A new home starts in the calm layout the specs were written for (`SB_E2E_STYLE=bento` for the
// Bento pass), seeded once, before the server first starts (F35.1).
if (!process.env.SB_E2E_HOME) {
  process.env.SB_E2E_HOME = mkdtempSync(path.join(tmpdir(), 'sb e2e Đồ án '));
  seedStyle(process.env.SB_E2E_HOME);
}
const home = process.env.SB_E2E_HOME;

export default defineConfig({
  testDir: 'web/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node server/dist/index.js --port ${port} --home "${home}"`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
