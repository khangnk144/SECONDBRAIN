/**
 * Canvas colors come from the design tokens (tokens.css), read once from the computed style of
 * <html> and read again whenever the theme or the palette attribute changes.
 */
import { useEffect, useState } from 'react';
import { GRAPH_GROUPS, type GraphGroup } from '../../lib/api/graph-types';

/** Token of each group's dot color (SPEC §7 graph tokens). */
export const GRAPH_GROUP_TOKENS: Record<GraphGroup, string> = {
  projects: '--graph-projects',
  areas: '--graph-areas',
  resources: '--graph-resources',
  wiki: '--graph-wiki',
  daily: '--graph-daily',
  other: '--graph-other',
};

export interface GraphPalette {
  /** Dot color per group, indexed like `GRAPH_GROUPS`. */
  groups: string[];
  /** Canvas background (`--bg`). */
  background: string;
  /** Labels of hovered, selected and lit nodes (`--ink`). */
  ink: string;
  /** Names shown without a hover (`--ink-2`), quieter than the highlighted ones. */
  quietInk: string;
  /** Edges at rest (`--ink-2`). */
  edge: string;
  /** Highlighted edges, signal dots and the selection ring (`--accent`). */
  accent: string;
  /** Label font family (`--font`). */
  font: string;
}

/** Attributes on <html> that switch token values (applyUiPrefs sets them). */
const THEME_ATTRIBUTES = ['data-theme', 'data-palette'];

export function readGraphPalette(root: Element = document.documentElement): GraphPalette {
  const style = getComputedStyle(root);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    groups: GRAPH_GROUPS.map((group) => read(GRAPH_GROUP_TOKENS[group])),
    background: read('--bg'),
    ink: read('--ink'),
    quietInk: read('--ink-2'),
    edge: read('--ink-2'),
    accent: read('--accent'),
    font: read('--font') || 'sans-serif',
  };
}

/**
 * The current palette; changes when `data-theme` or `data-palette` on <html> changes, and once
 * the UI font has loaded (names measured with a fallback font would be placed too narrow).
 */
export function useGraphPalette(): GraphPalette {
  const [palette, setPalette] = useState(readGraphPalette);
  useEffect(() => {
    const root = document.documentElement;
    let active = true;
    const reread = () => {
      if (active) setPalette(readGraphPalette(root));
    };
    const observer = new MutationObserver(reread);
    observer.observe(root, { attributes: true, attributeFilter: THEME_ATTRIBUTES });
    const fonts = typeof document.fonts === 'undefined' ? null : document.fonts;
    fonts?.addEventListener('loadingdone', reread);
    if (fonts && fonts.status !== 'loaded') void fonts.ready.then(reread);
    // The theme may have changed between the first render and this effect.
    reread();
    return () => {
      active = false;
      observer.disconnect();
      fonts?.removeEventListener('loadingdone', reread);
    };
  }, []);
  return palette;
}
