/// <reference lib="dom" />
// Keyboard-only run (no mouse, no clicks) of the formatting toolbar and the Word-style keys
// (owner request in M3): Tab into the toolbar, arrows to "Đậm", Enter applies it; Ctrl+B/I/U,
// Ctrl+Alt+2 and Ctrl+Shift+8 change the saved Markdown, underline saved as `<u>…</u>`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { appApi, resetVault } from './helpers/app-api.js';
import { expectFocus, focusedInfo, pressUntilFocused, settled } from './helpers/keyboard.js';
import { e2eVaultDir } from './helpers/vault-api.js';

test.afterEach(async ({ page }) => resetVault(await appApi(page)));

const notePath = '1 Projects/Định dạng e2e.md';
const readNote = () => readFileSync(path.join(e2eVaultDir(), ...notePath.split('/')), 'utf8');
const source = [
  '---',
  'type: note',
  '---',
  '',
  '# Định dạng e2e',
  '',
  'một hai ba',
  '',
  'chữ đậm',
  '',
  'chữ nghiêng',
  '',
  'chữ gạch',
  '',
  'Tiêu đề hai',
  '',
  'mục danh sách',
  '',
].join('\n');

/** Caret to the end of the next paragraph, then select its last word (`word`). */
async function selectLastWordBelow(page: Page, word: string): Promise<void> {
  await settled(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Shift+ArrowLeft');
  await settled(page);
  await expect.poll(() => page.evaluate(() => document.getSelection()?.toString())).toBe(word);
}

test('toolbar and formatting keys by keyboard change the saved Markdown', async ({ page }) => {
  const api = await appApi(page);
  await api.send('POST', '/api/note', { path: notePath, content: source });
  await page.goto(`/#/note?path=${encodeURIComponent(notePath)}`);
  const body = page.getByRole('textbox', { name: /Nội dung ghi chú/ });
  await expect(body).toContainText('một hai ba');

  // Select "ba" in the first paragraph.
  await pressUntilFocused(page, '.ProseMirror');
  await page.keyboard.press('Control+Home');
  await selectLastWordBelow(page, 'ba');

  // Into the toolbar (one Tab stop, reached backwards), arrows to "Đậm", Enter.
  await pressUntilFocused(page, '[role="toolbar"] [tabindex="0"]', { key: 'Shift+Tab', max: 10 });
  await pressUntilFocused(page, '[role="toolbar"] [aria-label="Đậm"]', {
    key: 'ArrowRight',
    max: 25,
  });
  await page.keyboard.press('Enter');
  await expectFocus(page, '.ProseMirror');
  await expect(body.locator('strong', { hasText: 'ba' })).toBeVisible();
  await expect(page.locator('[role="toolbar"] [aria-label="Đậm"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // The Word keys, one per paragraph; each result is on screen before the next key.
  await selectLastWordBelow(page, 'đậm');
  await page.keyboard.press('Control+b');
  await expect(body.locator('strong', { hasText: 'đậm' })).toBeVisible();
  await selectLastWordBelow(page, 'nghiêng');
  await page.keyboard.press('Control+i');
  await expect(body.locator('em', { hasText: 'nghiêng' })).toBeVisible();
  await selectLastWordBelow(page, 'gạch');
  await page.keyboard.press('Control+u');
  await expect(body.locator('u', { hasText: 'gạch' })).toBeVisible();
  await settled(page);
  await page.keyboard.press('ArrowDown');
  await settled(page);
  await page.keyboard.press('Control+Alt+2');
  await expect(body.locator('h2', { hasText: 'Tiêu đề hai' })).toBeVisible();
  await settled(page);
  await page.keyboard.press('ArrowDown');
  await settled(page);
  await page.keyboard.press('Control+Shift+8');
  await expect(body.locator('ul li', { hasText: 'mục danh sách' })).toBeVisible();
  expect((await focusedInfo(page)).className).toContain('ProseMirror');

  const expected = source
    .replace('một hai ba', 'một hai **ba**')
    .replace('chữ đậm', 'chữ **đậm**')
    .replace('chữ nghiêng', 'chữ *nghiêng*')
    .replace('chữ gạch', 'chữ <u>gạch</u>')
    .replace('\nTiêu đề hai\n', '\n## Tiêu đề hai\n')
    .replace('\nmục danh sách\n', '\n- mục danh sách\n');
  await expect.poll(readNote, { timeout: 10_000 }).toBe(expected);
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible();
});
