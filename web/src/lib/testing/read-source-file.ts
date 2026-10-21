/**
 * Reads a file of `web/src` from disk in a test. The web test project loads CSS as empty modules
 * and jsdom has no layout, so style contracts are checked on the rules themselves.
 */
const FS = 'node:fs';

export async function readWebSource(fromSrc: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ FS)) as {
    readFileSync(path: URL, encoding: 'utf8'): string;
  };
  // A variable, not a literal: Vite rewrites `new URL('<literal>', import.meta.url)` as an asset.
  const relative = `../../${fromSrc}`;
  return fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
}

/** The declarations of the first rule whose selector list is exactly `selector`. */
export function cssRule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no CSS rule "${selector}"`);
  return css.slice(start, css.indexOf('}', start));
}
