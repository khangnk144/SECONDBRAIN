/// <reference lib="dom" />
// Look checks of the Bento style that jsdom cannot see (review B1, B2, B6, B7): secondary buttons
// that melt into their box, checkboxes that are not the Bento square, elements drawn over the
// brain map's canvas, and Settings sub-groups as inner boxes.
import type { Page } from '@playwright/test';

/**
 * Visible secondary buttons whose background equals the surface they sit on and that have no
 * border of their own: they read as plain text (B1). The surface is the nearest ancestor with a
 * background colour, or the first colour of its background image (a tile's padding-box layer).
 */
export function meltedButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const firstColor = (image: string) => /rgba?\([^)]*\)/.exec(image)?.[0] ?? null;
    const surface = (start: Element | null): string => {
      for (let el = start; el; el = el.parentElement) {
        const style = getComputedStyle(el);
        const fromImage =
          style.backgroundImage === 'none' ? null : firstColor(style.backgroundImage);
        if (fromImage) return fromImage;
        if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') return style.backgroundColor;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    return [...document.querySelectorAll<HTMLElement>('.button--secondary')]
      .filter((button) => {
        const box = button.getBoundingClientRect();
        if (box.width === 0 || getComputedStyle(button).visibility === 'hidden') return false;
        const style = getComputedStyle(button);
        const under = surface(button.parentElement);
        const outlined =
          parseFloat(style.borderTopWidth) > 0 &&
          !/rgba\(\d+, \d+, \d+, 0\)/.test(style.borderTopColor) &&
          style.borderTopColor !== under;
        return !outlined && style.backgroundColor === under;
      })
      .map((button) => (button.textContent ?? '').trim());
  });
}

/** Visible checkboxes that are not the Bento square (20 px, radius 7, no native look, B2). */
export function nonBentoCheckboxes(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .filter((input) => {
        const style = getComputedStyle(input);
        return input.getBoundingClientRect().width > 0 && style.opacity !== '0';
      })
      .filter((input) => {
        const style = getComputedStyle(input);
        const box = input.getBoundingClientRect();
        return (
          style.appearance !== 'none' ||
          Math.round(box.width) !== 20 ||
          Math.round(box.height) !== 20 ||
          style.borderTopLeftRadius !== '7px'
        );
      })
      .map((input) => input.closest('label')?.textContent?.trim() || input.name || '?'),
  );
}

/** Overlays of the brain map (title, zoom, filters, scrubber, legend) that cover its canvas (B6). */
export function graphOverlaysOnCanvas(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.graph-screen__canvas')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('.graph-screen__stage [data-graph-overlay]')]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        const x = Math.min(box.right, canvas.right) - Math.max(box.left, canvas.left);
        const y = Math.min(box.bottom, canvas.bottom) - Math.max(box.top, canvas.top);
        return x > 1 && y > 1;
      })
      .map((el) => el.className);
  });
}
