/**
 * Build-time helper of the service worker plugin (no browser or Node APIs): which emitted files
 * the worker precaches. The shell page itself is excluded (it carries the session token and is
 * stored only from a real page load or the install fetch), and so is the worker script.
 */
const NEVER_PRECACHED = new Set(['index.html', 'sw.js']);

/** `fileNames` are output paths relative to the build folder (`assets/x.js`, `icons/a.png`). */
export function precachePaths(fileNames: Iterable<string>, base = '/'): string[] {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  const paths = new Set<string>();
  for (const raw of fileNames) {
    const fileName = raw.split('\\').join('/').replace(/^\/+/, '');
    if (fileName === '' || NEVER_PRECACHED.has(fileName)) continue;
    if (fileName.endsWith('.map') || fileName.startsWith('.')) continue;
    if (fileName.split('/').some((segment) => segment.startsWith('.'))) continue;
    paths.add(`${prefix}${fileName}`);
  }
  return [...paths].sort();
}
