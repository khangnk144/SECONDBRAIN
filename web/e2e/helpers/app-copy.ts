// "A new build" without rebuilding: a copy of the built app (server/dist + web/dist, the
// dependencies linked) whose service worker carries another BUILD_ID, as `npm run build` after a
// change would produce. A server started from the copy serves the same UI with a new `sw.js`.
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** The build id baked into `sw.js` (16 hex digits, the content hash of the build). */
export function buildIdOf(swSource: string): string {
  const ids = [...new Set(swSource.match(/`[0-9a-f]{16}`/g) ?? [])];
  if (ids.length !== 1) throw new Error(`expected one build id in sw.js, found ${ids.length}`);
  return ids[0]!.slice(1, -1);
}

export function currentBuildId(appDir = process.cwd()): string {
  return buildIdOf(readFileSync(path.join(appDir, 'web', 'dist', 'sw.js'), 'utf8'));
}

/**
 * Copies the built app into `target` with `sw.js`'s BUILD_ID replaced by `newId`; returns the
 * new app folder (pass it as `appDir` to `ownServer`).
 */
export function appCopyWithBuildId(target: string, newId: string, appDir = process.cwd()): string {
  const copy = path.join(target, 'app');
  mkdirSync(path.join(copy, 'server'), { recursive: true });
  cpSync(path.join(appDir, 'server', 'dist'), path.join(copy, 'server', 'dist'), {
    recursive: true,
  });
  cpSync(path.join(appDir, 'server', 'package.json'), path.join(copy, 'server', 'package.json'));
  cpSync(path.join(appDir, 'package.json'), path.join(copy, 'package.json'));
  cpSync(path.join(appDir, 'web', 'dist'), path.join(copy, 'web', 'dist'), { recursive: true });
  symlinkSync(path.join(appDir, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
  const serverModules = path.join(appDir, 'server', 'node_modules');
  if (existsSync(serverModules)) {
    symlinkSync(serverModules, path.join(copy, 'server', 'node_modules'), 'dir');
  }
  const sw = path.join(copy, 'web', 'dist', 'sw.js');
  const source = readFileSync(sw, 'utf8');
  writeFileSync(sw, source.replaceAll(`\`${buildIdOf(source)}\``, `\`${newId}\``));
  return copy;
}
