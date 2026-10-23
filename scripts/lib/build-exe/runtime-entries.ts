/**
 * The files of the runtime tree the executable carries (F29.1), all under `app/` so the
 * extracted folder looks like an install: `app/server/dist`, `app/web/dist`, `app/launcher/tray`,
 * the production packages at their original `node_modules` places, the two package manifests
 * (run-time fields only) and the CommonJS shim the SEA bootstrap loads.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  collectDependencyClosure,
  type ClosureResult,
  type TargetPlatform,
} from './dependency-closure.js';
import { keepFileOfPackage, RUNTIME_UNUSED_PACKAGES } from './prune-rules.js';

export interface PayloadEntry {
  /** POSIX path inside the payload, e.g. `app/server/dist/index.js`. */
  path: string;
  /** File to read (absolute) … */
  source?: string;
  /** … or the bytes themselves. */
  data?: Buffer;
  executable?: boolean;
}

export interface RuntimeEntries {
  entries: PayloadEntry[];
  closure: ClosureResult;
}

/** CommonJS file the bootstrap can `require`; ESM cannot be imported from the SEA main script. */
export const SEA_ENTRY_SHIM = 'app/sea-entry.cjs';
const SHIM_SOURCE = `'use strict';
// Loaded by the Second Brain executable's bootstrap (scripts/lib/build-exe/sea-bootstrap.ts):
// the single-executable main script can only require built-in modules, this file can import.
module.exports = (entry) => import(require('node:url').pathToFileURL(require('node:path').join(__dirname, entry)).href);
`;

/** Lists files below `dir` as POSIX paths relative to it, sorted; links are never followed. */
export function listTree(dir: string, skipDir: (rel: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const entries = readdirSync(path.join(dir, rel), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!skipDir(child)) walk(child);
      } else if (entry.isFile()) {
        out.push(child);
      }
    }
  };
  walk('');
  return out;
}

const isExecutable = (file: string) =>
  process.platform !== 'win32' && (lstatSync(file).mode & 0o111) !== 0;

function filesOf(
  sourceDir: string,
  prefix: string,
  keep: (rel: string) => boolean,
  skipDir?: (rel: string) => boolean,
): PayloadEntry[] {
  return listTree(sourceDir, skipDir)
    .filter(keep)
    .map((rel) => {
      const source = path.join(sourceDir, ...rel.split('/'));
      return { path: `${prefix}/${rel}`, source, executable: isExecutable(source) };
    });
}

/** Only the manifest fields Node reads at run time (`type` decides ESM vs CommonJS). */
export function runtimeManifest(file: string): Buffer {
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const fields = ['name', 'version', 'private', 'type', 'main', 'engines'];
  const kept = Object.fromEntries(fields.filter((key) => key in pkg).map((key) => [key, pkg[key]]));
  return Buffer.from(`${JSON.stringify(kept, null, 2)}\n`);
}

export function collectRuntimeEntries(rootDir: string, target: TargetPlatform): RuntimeEntries {
  const root = path.resolve(rootDir);
  const closure = collectDependencyClosure(path.join(root, 'server'), root, {
    target,
    exclude: RUNTIME_UNUSED_PACKAGES,
  });
  const noMaps = (rel: string) => !rel.endsWith('.map');
  const entries: PayloadEntry[] = [
    { path: 'app/package.json', data: runtimeManifest(path.join(root, 'package.json')) },
    { path: SEA_ENTRY_SHIM, data: Buffer.from(SHIM_SOURCE) },
    {
      path: 'app/server/package.json',
      data: runtimeManifest(path.join(root, 'server/package.json')),
    },
    ...filesOf(path.join(root, 'server/dist'), 'app/server/dist', noMaps),
    ...filesOf(path.join(root, 'web/dist'), 'app/web/dist', () => true),
    ...filesOf(path.join(root, 'launcher/tray'), 'app/launcher/tray', () => true),
  ];
  for (const pkg of closure.packages) {
    entries.push(
      ...filesOf(
        pkg.dir,
        `app/${pkg.rel}`,
        (rel) => keepFileOfPackage(pkg.name, rel, target),
        (rel) => rel === 'node_modules' || rel.endsWith('/node_modules'),
      ),
    );
  }
  return { entries, closure };
}
