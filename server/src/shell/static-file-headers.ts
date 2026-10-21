import { readdirSync } from 'node:fs';
import path from 'node:path';

/** The service worker script, at the root of web/dist so its scope can be "/". */
export const SERVICE_WORKER_PATH = '/sw.js';
export const WEB_MANIFEST_PATH = '/manifest.webmanifest';

/**
 * URL paths of the files in web/dist outside `assets/` (favicon, manifest, sw.js, icons/…),
 * built from the real names on disk. index.html is left out: the raw template is only ever
 * rendered through "/" with its placeholders filled in.
 */
export function listDistPublicPaths(distDir: string): Set<string> {
  const paths = new Set<string>();
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const urlPath = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (urlPath !== '/assets') walk(path.join(dir, entry.name), urlPath);
      } else if (entry.isFile() && urlPath !== '/index.html') {
        paths.add(urlPath);
      }
    }
  };
  walk(distDir, '');
  return paths;
}

/**
 * Headers that differ from the static server's defaults. The worker script and the manifest
 * must never be served from the HTTP cache without asking the server ("no-cache"), so a new
 * build or a changed port is seen on the next check; browsers also require a JavaScript MIME
 * type for the worker and expect the manifest's own type.
 */
export function staticFileHeaders(urlPath: string): Record<string, string> {
  if (urlPath === SERVICE_WORKER_PATH) {
    return { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' };
  }
  if (urlPath === WEB_MANIFEST_PATH) {
    return {
      'content-type': 'application/manifest+json; charset=utf-8',
      'cache-control': 'no-cache',
    };
  }
  return {};
}

/** URL path ("/sw.js") of a file inside `distDir`, as the static server resolved it. */
export function distUrlPath(distDir: string, filePath: string): string {
  return `/${path.relative(distDir, filePath).split(path.sep).join('/')}`;
}
