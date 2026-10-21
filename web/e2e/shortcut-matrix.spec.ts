/// <reference lib="dom" />
// Shortcut matrix, browser-tab half (SPEC F22.1, F22.2): every registered app shortcut fires on
// the screen it belongs to, none fires while the quick-capture box or the palette input expects
// raw typing (Esc closes them), and Ctrl+/ lists exactly the registry. The installed-PWA column
// is a manual Windows check. The registry is read from the source, so a new shortcut shows up here.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { appApi, localIso, resetVault } from './helpers/app-api.js';
import { appReady, cursorSettled, expectFocus } from './helpers/keyboard.js';

test.afterEach(async ({ page }) => resetVault(await appApi(page)));

const webSrc = path.join(process.cwd(), 'web', 'src');
/** `{ id, keys }` of APP_SHORTCUTS plus the note screen's own registration (Alt+S). */
function registry(): { id: string; keys: string }[] {
  const pairs = (file: string) =>
    [
      ...readFileSync(path.join(webSrc, file), 'utf8').matchAll(
        /id: '([^']+)',\s*keys: '([^']+)'/g,
      ),
    ].map((m) => ({ id: m[1]!, keys: m[2]! }));
  return [...pairs('lib/shortcuts/use-app-shortcuts.ts'), ...pairs('features/note/note-view.tsx')];
}
const APP_KEYS = registry().filter((s) => s.id !== 'source-mode');
const NOTE_KEYS = registry();

/** Playwright key name for a registry combination (`Ctrl+K` → `Control+k`). */
const pwKeys = (keys: string) =>
  keys
    .split('+')
    .map((part) => (part === 'Ctrl' ? 'Control' : part.length === 1 ? part.toLowerCase() : part))
    .join('+');

const noteA = '1 Projects/Phím tắt A.md';
const noteB = '1 Projects/Phím tắt B.md';
const noteUrl = (p: string) => `/#/note?path=${encodeURIComponent(p)}`;
const tabs = (page: Page) =>
  page.getByRole('navigation', { name: 'Thẻ ghi chú đang mở' }).locator('.tab');

/** Note A open, then B in a second tab via Ctrl+Enter in the palette (B becomes active). */
async function twoTabs(page: Page): Promise<void> {
  await page.goto(noteUrl(noteA));
  await appReady(page);
  await expect(page.getByRole('textbox', { name: /Tiêu đề ghi chú/ })).toHaveValue('Phím tắt A');
  await page.keyboard.press('Control+k');
  const answered = page.waitForResponse((r) => r.url().includes('/api/search'));
  await page.keyboard.type('Phím tắt B');
  await answered;
  await expect(page.locator('.palette-option').first()).toContainText('Phím tắt B');
  await page.keyboard.press('Control+Enter');
  await expect(tabs(page)).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: /Tiêu đề ghi chú/ })).toHaveValue('Phím tắt B');
}

/** Everything a shortcut could change, to compare before/after a key that must do nothing. */
function appState(page: Page) {
  return page.evaluate(() => ({
    url: location.hash,
    leftCollapsed: document.querySelector('.app-shell--left-collapsed') !== null,
    rightPanel: document.querySelector('aside.right-panel') !== null,
    tabs: document.querySelectorAll('.tab-bar .tab').length,
    activeTab: document.querySelector('.tab-bar [aria-current="page"]')?.textContent ?? '',
    dialogs: [...document.querySelectorAll('[role="dialog"], [role="listbox"]')].map(
      (el) => el.getAttribute('aria-labelledby') ?? el.className,
    ).length,
    sourceMode: document.querySelector('.source-editor') !== null,
    focused: document.activeElement?.className ?? '',
  }));
}

test.beforeEach(async ({ page }) => {
  const api = await appApi(page);
  for (const [p, title] of [
    [noteA, 'Phím tắt A'],
    [noteB, 'Phím tắt B'],
  ] as const) {
    await api.send('POST', '/api/note', { path: p, content: `# ${title}\n\nNội dung.\n` });
  }
});

test('every app shortcut fires on its screen (F22.1, browser tab)', async ({ page }) => {
  const fired: Record<string, boolean> = {};
  const today = localIso();
  const shell = page.locator('.app-shell');
  const rightPane = page.getByRole('complementary', { name: 'Ngăn bên phải' });
  const run = async (id: string, check: () => Promise<void>) => {
    await check();
    fired[id] = true;
  };
  const keysOf = (id: string) => pwKeys(NOTE_KEYS.find((s) => s.id === id)!.keys);

  await page.goto('/');
  await appReady(page);
  await run('toggle-left-pane', async () => {
    await page.keyboard.press(keysOf('toggle-left-pane'));
    await expect(shell).toHaveClass(/app-shell--left-collapsed/);
    await page.keyboard.press(keysOf('toggle-left-pane'));
    await expect(shell).not.toHaveClass(/app-shell--left-collapsed/);
  });
  await run('search', async () => {
    await page.keyboard.press(keysOf('search'));
    await expect(page.getByRole('combobox', { name: 'Tìm ghi chú' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox', { name: 'Tìm ghi chú' })).toHaveCount(0);
  });
  await run('quick-capture', async () => {
    await page.keyboard.press(keysOf('quick-capture'));
    await expectFocus(page, '.capture-box__input');
    await page.keyboard.press('Escape');
    await expect(page.locator('.capture-box')).toHaveCount(0);
  });
  await run('shortcut-sheet', async () => {
    await page.keyboard.press(keysOf('shortcut-sheet'));
    await expect(page.getByRole('dialog', { name: 'Phím tắt' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Phím tắt' })).toHaveCount(0);
  });
  await run('new-note', async () => {
    await page.keyboard.press(keysOf('new-note'));
    await expect(page.getByRole('listbox')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
  });
  await run('graph', async () => {
    await page.keyboard.press(keysOf('graph'));
    await expect(page).toHaveURL(/#\/graph/);
  });
  await run('settings', async () => {
    await page.keyboard.press(keysOf('settings'));
    await expect(page).toHaveURL(/#\/settings$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Cài đặt' })).toBeVisible();
  });
  await run('daily-note', async () => {
    await page.keyboard.press(keysOf('daily-note'));
    await expect(page).toHaveURL(new RegExp(`path=Daily%2F${today}\\.md`));
    await cursorSettled(page);
  });

  await twoTabs(page);
  await run('toggle-right-pane', async () => {
    await expect(rightPane).toBeVisible();
    await page.keyboard.press(keysOf('toggle-right-pane'));
    await expect(rightPane).toHaveCount(0);
    await page.keyboard.press(keysOf('toggle-right-pane'));
    await expect(rightPane).toBeVisible();
  });
  await run('source-mode', async () => {
    await page.keyboard.press(keysOf('source-mode'));
    await expect(page.locator('.source-editor')).toBeVisible();
    await page.keyboard.press(keysOf('source-mode'));
    await expect(page.locator('.source-editor')).toHaveCount(0);
  });
  const title = page.getByRole('textbox', { name: /Tiêu đề ghi chú/ });
  await run('previous-tab', async () => {
    await page.keyboard.press(keysOf('previous-tab'));
    await expect(title).toHaveValue('Phím tắt A');
  });
  await run('next-tab', async () => {
    await page.keyboard.press(keysOf('next-tab'));
    await expect(title).toHaveValue('Phím tắt B');
  });
  await run('close-tab', async () => {
    await page.keyboard.press(keysOf('close-tab'));
    await expect(tabs(page)).toHaveCount(1);
    await expect(title).toHaveValue('Phím tắt A');
  });

  console.log(`fired in tab: ${JSON.stringify(fired)}`);
  expect(Object.keys(fired).sort()).toEqual(NOTE_KEYS.map((s) => s.id).sort());
});

for (const overlay of ['capture', 'palette'] as const) {
  test(`no app shortcut fires while typing in the ${overlay} input; Esc closes it (F22.1)`, async ({
    page,
  }) => {
    await twoTabs(page);
    const input =
      overlay === 'capture'
        ? page.locator('.capture-box__input')
        : page.getByRole('combobox', { name: 'Tìm ghi chú' });
    await page.keyboard.press(overlay === 'capture' ? 'Alt+q' : 'Control+k');
    await expect(input).toBeFocused();
    await page.keyboard.type('gõ');
    const before = await appState(page);
    const blocked: string[] = [];
    for (const shortcut of NOTE_KEYS) {
      await page.keyboard.press(pwKeys(shortcut.keys));
      // A shortcut that fires acts within a frame or after one request: give it time to show.
      await page.waitForTimeout(250);
      await expect(input, `${shortcut.keys} closed the ${overlay}`).toBeFocused();
      expect(await appState(page), `${shortcut.keys} fired inside the ${overlay}`).toEqual(before);
      // Ctrl+K inside the palette selects its query (typing then replaces it): put it back.
      if (overlay === 'palette' && shortcut.id === 'search') {
        await page.keyboard.press('End');
      }
      expect(await input.inputValue()).toBe('gõ');
      blocked.push(shortcut.keys);
    }
    console.log(`blocked in ${overlay}: ${blocked.join(' ')}`);
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
  });
}

test('Ctrl+/ lists exactly the registered app shortcuts (F22.2)', async ({ page }) => {
  const sheetRows = async () => {
    const sheet = page.getByRole('dialog', { name: 'Phím tắt' });
    await expect(sheet).toBeVisible();
    const app = sheet.getByRole('region', { name: 'Trong cả app' });
    const rows = await app
      .locator('.shortcut-sheet__row')
      .evaluateAll((items) =>
        items.map((li) => [...li.querySelectorAll('kbd')].map((k) => k.textContent).join('+')),
      );
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    return rows.sort();
  };
  await page.goto('/');
  await appReady(page);
  await page.keyboard.press('Control+/');
  const appRows = await sheetRows();
  expect(appRows).toEqual(APP_KEYS.map((s) => s.keys).sort());
  expect(appRows).toContain('Alt+,');

  // On a note, the note screen's Alt+S is registered too and listed once.
  await page.goto(noteUrl(noteA));
  await expect(page.getByRole('textbox', { name: /Tiêu đề ghi chú/ })).toHaveValue('Phím tắt A');
  await page.keyboard.press('Control+/');
  expect(await sheetRows()).toEqual(NOTE_KEYS.map((s) => s.keys).sort());
});
