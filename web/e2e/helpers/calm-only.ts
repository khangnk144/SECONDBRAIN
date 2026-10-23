// Specs about the calm layout itself (its Today sections, its sidebar) run in calm in every pass:
// in a `SB_E2E_STYLE=bento` run the shared server is switched to calm for that spec file and back
// to the run's style after it (F35.1: the style applies at once, no restart). Bento has its own
// versions of those checks (`bento-today.spec.ts`, `bento-shell.spec.ts`).
import { test } from '@playwright/test';
import { standaloneApi } from './app-api.js';
import { runStyle, type E2eStyle } from './e2e-style.js';

async function putStyle(style: E2eStyle): Promise<void> {
  const api = await standaloneApi();
  try {
    await api.send('PUT', '/api/settings', { ui: { style } });
  } finally {
    await api.dispose();
  }
}

/** Call at the top level of a spec file that tests the calm layout. */
export function calmOnly(): void {
  if (runStyle() === 'calm') return;
  test.beforeAll(async () => putStyle('calm'));
  test.afterAll(async () => putStyle(runStyle()));
}
