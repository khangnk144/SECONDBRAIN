/// <reference lib="dom" />
// Keyboard-only helpers: the keyboard-only specs never use `page.mouse` or clicks; they move with
// Tab/arrows and read where focus is.
import { expect, type Locator, type Page } from '@playwright/test';

/** Short description of the focused element (tag, role, name or text), for assertions. */
export function focusedInfo(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      tag: el?.tagName.toLowerCase() ?? '',
      role: el?.getAttribute('role') ?? '',
      label: el?.getAttribute('aria-label') ?? '',
      text: (el?.textContent ?? '').trim().slice(0, 120),
      key: el?.dataset['key'] ?? el?.dataset['date'] ?? '',
      className: typeof el?.className === 'string' ? el.className : '',
    };
  });
}

/**
 * Presses `key` (Tab by default) until the focused element matches `selector`; fails after `max`
 * presses. Returns the number of presses.
 */
export async function pressUntilFocused(
  page: Page,
  selector: string,
  { key = 'Tab', max = 80 }: { key?: string; max?: number } = {},
): Promise<number> {
  for (let presses = 0; presses <= max; presses += 1) {
    const matches = await page.evaluate(
      (sel) => document.activeElement?.matches(sel) ?? false,
      selector,
    );
    if (matches) return presses;
    await page.keyboard.press(key);
  }
  const info = await focusedInfo(page);
  throw new Error(
    `"${selector}" not focused after ${max} × ${key}; focus is on ${JSON.stringify(info)}`,
  );
}

/** Like `pressUntilFocused`, for an element found by role or text (a `Locator`). */
export async function pressUntilLocatorFocused(
  page: Page,
  target: Locator,
  { key = 'Tab', max = 80 }: { key?: string; max?: number } = {},
): Promise<number> {
  for (let presses = 0; presses <= max; presses += 1) {
    const focused = await target.evaluateAll((list) =>
      list.some((el) => el === document.activeElement),
    );
    if (focused) return presses;
    await page.keyboard.press(key);
  }
  const info = await focusedInfo(page);
  throw new Error(`target not focused after ${max} × ${key}; focus is on ${JSON.stringify(info)}`);
}

/** The focused element matches `selector` (retries until it does). */
export async function expectFocus(page: Page, selector: string): Promise<void> {
  try {
    await expect
      .poll(() => page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, selector))
      .toBe(true);
  } catch {
    const info = await focusedInfo(page);
    throw new Error(`focus is not on ${selector}; it is on ${JSON.stringify(info)}`);
  }
}

/**
 * Two animation frames: the editor has drawn the last change and read the caret the browser just
 * moved (ProseMirror learns of native caret moves through `selectionchange`, so a command key sent
 * in the same instant as an arrow key would still act on the old position; people never type that
 * fast).
 */
export const settled = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/**
 * The app has read its per-vault state (panes, tabs) and the folder tree: a shortcut pressed
 * before that can be undone by the hydration that follows `GET /health`.
 */
export async function appReady(page: Page): Promise<void> {
  await expect(page.getByRole('tree').getByRole('treeitem').first()).toBeVisible();
}

/** A note opened with `&cursor=N` has placed the caret and dropped the parameter. */
export async function cursorSettled(page: Page): Promise<void> {
  await expect(page).not.toHaveURL(/[?&]cursor=/);
}
