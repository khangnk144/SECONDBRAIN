/// <reference lib="dom" />
// The note screen as the specs use it: title and body boxes, the address of a note, and putting
// the caret on a new empty line at the end (where a drop or typing then lands).
import { expect, type Page } from '@playwright/test';

export const noteBody = (page: Page) => page.getByRole('textbox', { name: /Nội dung ghi chú/ });
export const noteTitle = (page: Page) => page.getByRole('textbox', { name: /Tiêu đề ghi chú/ });
export const noteBodyEn = (page: Page) => page.getByRole('textbox', { name: /Note content/ });
export const noteHash = (notePath: string) => `#/note?path=${encodeURIComponent(notePath)}`;

/**
 * Focuses the body and moves the caret to the end of its last block. Ctrl+End right after the
 * editor got focus can fire before the browser has put the caret inside it, so it is pressed
 * until the caret really sits in the last block.
 */
export async function caretToEnd(page: Page): Promise<void> {
  await page.locator('.ProseMirror').focus();
  await expect
    .poll(async () => {
      await page.keyboard.press('Control+End');
      return page.evaluate(() => {
        const last = document.querySelector('.ProseMirror')?.lastElementChild;
        const anchor = document.getSelection()?.anchorNode ?? null;
        return Boolean(last && anchor && last.contains(anchor));
      });
    })
    .toBe(true);
}

/** Caret on a new, empty paragraph at the end of the note; returns that paragraph. */
export async function newLastLine(page: Page) {
  await caretToEnd(page);
  await page.keyboard.press('Enter');
  const last = page.locator('.ProseMirror > p:last-child');
  await expect(last).toHaveText('');
  return last;
}

/** The note on disk (through the API) eventually contains `text`. */
export async function expectSaved(
  read: () => Promise<{ content: string }>,
  text: string,
  timeout = 10_000,
): Promise<void> {
  await expect.poll(async () => (await read()).content, { timeout }).toContain(text);
}
