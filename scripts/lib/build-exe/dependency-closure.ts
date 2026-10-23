/**
 * The production dependency closure of a package (F29.1): every installed package that
 * `dependencies`, `optionalDependencies` and required `peerDependencies` reach, resolved from
 * the installed `node_modules` with Node's own rules (nearest `node_modules` folder first, then
 * each parent folder: hoisted and nested copies both work, two versions of one name too).
 * `devDependencies` are never followed. Only folders inside `rootDir` count, so the staged tree
 * can mirror the original layout and resolve exactly like it.
 */
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface ClosurePackage {
  name: string;
  version: string;
  /** Absolute package folder. */
  dir: string;
  /** Folder relative to `rootDir`, POSIX separators (`node_modules/@scope/x`). */
  rel: string;
}

export interface ClosureResult {
  /** Sorted by `rel`. */
  packages: ClosurePackage[];
  /** Optional dependencies and peers that are not installed (skipped). */
  skipped: string[];
}

interface Manifest {
  name?: string;
  version?: string;
  os?: string[];
  cpu?: string[];
  libc?: string[];
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

export class ClosureError extends Error {}

/** The machine the build is for (npm's `os` / `cpu` / `libc` package fields). */
export interface TargetPlatform {
  os: NodeJS.Platform;
  cpu: string;
  /** Linux only. */
  libc?: 'glibc' | 'musl';
}

export interface ClosureOptions {
  target?: TargetPlatform;
  /** Package names never followed (not needed at run time), recorded in `skipped`. */
  exclude?: readonly string[];
}

/** npm's rule: a list allows the value, `!value` entries forbid it, no list allows all. */
function allows(list: string[] | undefined, value: string | undefined): boolean {
  if (!list || list.length === 0 || value === undefined) return true;
  if (list.includes(`!${value}`)) return false;
  const positive = list.filter((entry) => !entry.startsWith('!'));
  return positive.length === 0 || positive.includes(value);
}

export function fitsTarget(manifest: Manifest, target: TargetPlatform): boolean {
  return (
    allows(manifest.os, target.os) &&
    allows(manifest.cpu, target.cpu) &&
    (target.os !== 'linux' || allows(manifest.libc, target.libc))
  );
}

/** The platform this process runs on. */
export function currentTarget(): TargetPlatform {
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } };
  return {
    os: process.platform,
    cpu: process.arch,
    libc:
      process.platform === 'linux'
        ? report?.header?.glibcVersionRuntime
          ? 'glibc'
          : 'musl'
        : undefined,
  };
}

const toPosix = (value: string) => value.split(path.sep).join('/');

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as Manifest;
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * The folder Node would load `name` from when required by a file in `fromDir`, or null.
 * Stops at `rootDir`: a package outside the repo cannot be staged next to the others.
 */
export function resolvePackageDir(name: string, fromDir: string, rootDir: string): string | null {
  let dir = path.resolve(fromDir);
  const root = path.resolve(rootDir);
  for (;;) {
    // Inside a `node_modules` folder Node does not look in `node_modules/node_modules`.
    if (path.basename(dir) !== 'node_modules') {
      const candidate = path.join(dir, 'node_modules', ...name.split('/'));
      try {
        lstatSync(path.join(candidate, 'package.json'));
        return candidate;
      } catch {
        // not here: try the parent folder
      }
    }
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir || !isInside(parent, root)) return null;
    dir = parent;
  }
}

/**
 * What a manifest needs at run time: `true` = must be installed. Optional dependencies and
 * required peers are followed when installed (a peer is the host's job, so a missing one is
 * skipped); optional peers are never followed (they would pull in tools like `typescript`).
 */
function runtimeNeeds(manifest: Manifest): Map<string, boolean> {
  const needs = new Map<string, boolean>();
  for (const [name] of Object.entries(manifest.peerDependencies ?? {})) {
    if (manifest.peerDependenciesMeta?.[name]?.optional !== true) needs.set(name, false);
  }
  for (const name of Object.keys(manifest.dependencies ?? {})) needs.set(name, true);
  // npm also lists optional dependencies under `dependencies`; optional wins.
  for (const name of Object.keys(manifest.optionalDependencies ?? {})) needs.set(name, false);
  return needs;
}

/**
 * Walks the closure starting at the package in `startDir` (which itself is not included).
 * Optional packages built for another platform (`os`/`cpu`/`libc`) are skipped like npm does.
 */
export function collectDependencyClosure(
  startDir: string,
  rootDir: string,
  options: ClosureOptions = {},
): ClosureResult {
  const root = path.resolve(rootDir);
  const target = options.target ?? currentTarget();
  const exclude = new Set(options.exclude ?? []);
  const seen = new Map<string, ClosurePackage>();
  const skipped = new Set<string>();
  const queue: Array<{ dir: string; manifest: Manifest }> = [
    { dir: path.resolve(startDir), manifest: readManifest(startDir) },
  ];
  while (queue.length > 0) {
    const { dir, manifest } = queue.shift() as { dir: string; manifest: Manifest };
    for (const [name, required] of runtimeNeeds(manifest)) {
      if (exclude.has(name)) {
        skipped.add(name);
        continue;
      }
      const found = resolvePackageDir(name, dir, root);
      if (found === null) {
        if (!required) {
          skipped.add(name);
          continue;
        }
        const from = manifest.name ?? toPosix(path.relative(root, dir));
        throw new ClosureError(`${from} needs ${name}, which is not installed (run npm install).`);
      }
      if (seen.has(found)) continue;
      if (lstatSync(found).isSymbolicLink()) {
        throw new ClosureError(`${name} is a linked package (${found}); install it normally.`);
      }
      const own = readManifest(found);
      if (!required && !fitsTarget(own, target)) {
        skipped.add(name);
        continue;
      }
      seen.set(found, {
        name: own.name ?? name,
        version: own.version ?? '0.0.0',
        dir: found,
        rel: toPosix(path.relative(root, found)),
      });
      queue.push({ dir: found, manifest: own });
    }
  }
  const packages = [...seen.values()].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { packages, skipped: [...skipped].sort() };
}
