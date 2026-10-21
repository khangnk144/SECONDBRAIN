/**
 * The accent of each palette in the theme on screen, read from the palette's own tokens
 * (tokens.css defines them on `<html>` only): the attribute is switched and read back within one
 * task, so nothing is painted in between.
 */
import { PALETTES, type Palette } from '../../lib/ui-prefs';

export function readPaletteAccents(doc: Document = document): Partial<Record<Palette, string>> {
  const root = doc.documentElement;
  const view = doc.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') return {};
  const original = root.dataset.palette;
  const accents: Partial<Record<Palette, string>> = {};
  try {
    for (const palette of PALETTES) {
      root.dataset.palette = palette;
      const value = view.getComputedStyle(root).getPropertyValue('--accent').trim();
      if (value) accents[palette] = value;
    }
  } finally {
    if (original === undefined) delete root.dataset.palette;
    else root.dataset.palette = original;
  }
  return accents;
}
