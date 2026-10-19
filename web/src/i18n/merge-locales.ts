/**
 * Translations are split by feature so several features can grow their strings independently:
 * `vi.json` / `en.json` hold the core keys, and every `locales/<area>.<lang>.json` holds the
 * keys of one feature area, merged under the top-level key `<area>` (e.g. `locales/editor.vi.json`
 * → `t('editor.…')`). The parity script (`scripts/check-i18n-parity.ts`) applies the same rule.
 */
export type LocaleTree = { [key: string]: string | LocaleTree };

const AREA_FILE = /(?:^|\/)([a-z0-9-]+)\.(vi|en)\.json$/;

/** Splits `{path: tree}` into `{lang: {area: tree}}`; unknown file names are ignored. */
export function groupAreaFiles(
  files: Record<string, LocaleTree>,
): Record<'vi' | 'en', Record<string, LocaleTree>> {
  const out: Record<'vi' | 'en', Record<string, LocaleTree>> = { vi: {}, en: {} };
  for (const [file, tree] of Object.entries(files)) {
    const match = AREA_FILE.exec(file.replace(/\\/g, '/'));
    if (!match) continue;
    const [, area, lang] = match as unknown as [string, string, 'vi' | 'en'];
    out[lang][area] = tree;
  }
  return out;
}

/** Core keys plus one subtree per area. An area may not reuse a core top-level key. */
export function mergeLocale(core: LocaleTree, areas: Record<string, LocaleTree>): LocaleTree {
  const merged: LocaleTree = { ...core };
  for (const [area, tree] of Object.entries(areas)) {
    if (area in core) throw new Error(`i18n area "${area}" collides with a core key`);
    merged[area] = tree;
  }
  return merged;
}
