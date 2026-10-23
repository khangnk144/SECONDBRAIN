// Production dependency closure and what the executable leaves out (F29.1).
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClosureError,
  collectDependencyClosure,
  fitsTarget,
  resolvePackageDir,
  type TargetPlatform,
} from './lib/build-exe/dependency-closure.js';
import { buildNeededReason } from './lib/build-exe/ensure-app-build.js';
import { keepFileOfPackage } from './lib/build-exe/prune-rules.js';
import { collectRuntimeEntries } from './lib/build-exe/runtime-entries.js';

const LINUX: TargetPlatform = { os: 'linux', cpu: 'x64', libc: 'glibc' };
const WINDOWS: TargetPlatform = { os: 'win32', cpu: 'x64' };
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function write(root: string, rel: string, content: string | object) {
  const file = path.join(root, ...rel.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
}

/** A repo like ours: hoisted root node_modules, nested copies, two versions of one name. */
function fixtureRepo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sb closure Đồ án '));
  roots.push(root);
  const pkg = (rel: string, manifest: object) => write(root, `${rel}/package.json`, manifest);
  pkg('.', { name: 'repo', version: '1.0.0', type: 'module', devDependencies: { vitest: '1' } });
  pkg('server', {
    name: '@x/server',
    version: '0.1.0',
    type: 'module',
    scripts: { build: 'tsc' },
    dependencies: { a: '^2', '@scope/b': '^1' },
    optionalDependencies: { 'opt-missing': '^1', 'opt-darwin': '^1', 'opt-linux': '^1' },
    devDependencies: { 'dev-only': '^1' },
  });
  pkg('server/node_modules/a', { name: 'a', version: '2.0.0' });
  pkg('node_modules/a', { name: 'a', version: '1.0.0' });
  pkg('node_modules/@scope/b', {
    name: '@scope/b',
    version: '1.0.0',
    dependencies: { c: '^1', unused: '^1' },
    peerDependencies: { d: '^1', 'peer-opt': '^1' },
    peerDependenciesMeta: { 'peer-opt': { optional: true } },
  });
  pkg('node_modules/c', { name: 'c', version: '1.0.0', dependencies: { a: '^1', f: '^1' } });
  pkg('node_modules/c/node_modules/f', { name: 'f', version: '3.0.0' });
  pkg('node_modules/d', { name: 'd', version: '1.0.0' });
  pkg('node_modules/unused', { name: 'unused', version: '1.0.0' });
  pkg('node_modules/peer-opt', { name: 'peer-opt', version: '1.0.0' });
  pkg('node_modules/opt-darwin', { name: 'opt-darwin', version: '1.0.0', os: ['darwin'] });
  pkg('node_modules/opt-linux', {
    name: 'opt-linux',
    version: '1.0.0',
    os: ['linux'],
    libc: ['glibc'],
  });
  pkg('node_modules/dev-only', { name: 'dev-only', version: '1.0.0' });
  pkg('node_modules/vitest', { name: 'vitest', version: '1.0.0' });
  return root;
}

describe('production dependency closure (F29.1)', () => {
  it('follows Node resolution: nested before hoisted, two versions, peers, optional deps', () => {
    const root = fixtureRepo();
    const result = collectDependencyClosure(path.join(root, 'server'), root, {
      target: LINUX,
      exclude: ['unused'],
    });
    expect(result.packages.map((p) => `${p.rel}@${p.version}`)).toEqual([
      'node_modules/@scope/b@1.0.0',
      'node_modules/a@1.0.0',
      'node_modules/c@1.0.0',
      'node_modules/c/node_modules/f@3.0.0',
      'node_modules/d@1.0.0',
      'node_modules/opt-linux@1.0.0',
      'server/node_modules/a@2.0.0',
    ]);
    // Never dev dependencies, optional peers, other platforms' packages or excluded names.
    expect(result.skipped).toEqual(['opt-darwin', 'opt-missing', 'unused']);
  });

  it('follows the target platform for optional packages (os, cpu, libc)', () => {
    const root = fixtureRepo();
    const windows = collectDependencyClosure(path.join(root, 'server'), root, { target: WINDOWS });
    expect(windows.packages.map((p) => p.name)).not.toContain('opt-linux');
    expect(fitsTarget({ os: ['!win32'] }, WINDOWS)).toBe(false);
    expect(fitsTarget({ libc: ['musl'] }, LINUX)).toBe(false);
    expect(fitsTarget({ libc: ['musl'] }, WINDOWS)).toBe(true);
  });

  it('a missing required dependency stops the build; resolution never leaves the repo', () => {
    const root = fixtureRepo();
    write(root, 'node_modules/c/package.json', { name: 'c', dependencies: { gone: '1' } });
    expect(() =>
      collectDependencyClosure(path.join(root, 'server'), root, { target: LINUX }),
    ).toThrow(ClosureError);
    expect(resolvePackageDir('vitest', path.join(root, 'server'), root)).toBe(
      path.join(root, 'node_modules', 'vitest'),
    );
    expect(resolvePackageDir('nowhere', path.join(root, 'server'), root)).toBeNull();
  });
});

describe('files left out of the executable (F29.1)', () => {
  it('drops docs, maps, declarations, TypeScript sources and test folders; keeps licenses', () => {
    const keep = (rel: string) => keepFileOfPackage('x', rel, LINUX);
    expect(keep('lib/index.js')).toBe(true);
    expect(keep('lib/test.js')).toBe(true);
    expect(keep('package.json')).toBe(true);
    expect(keep('LICENSE.md')).toBe(true);
    expect(keep('README.md')).toBe(false);
    expect(keep('dist/index.js.map')).toBe(false);
    expect(keep('dist/index.d.ts')).toBe(false);
    expect(keep('dist/index.d.cts')).toBe(false);
    expect(keep('src/index.ts')).toBe(false);
    expect(keep('test/unit.js')).toBe(false);
    expect(keep('docs/guide.html')).toBe(false);
    expect(keep('node_modules/y/index.js')).toBe(false);
  });

  it('keeps only the native addon of the target and the PDF build the server imports', () => {
    expect(keepFileOfPackage('better-sqlite3', 'prebuilds/linux-x64.node', LINUX)).toBe(true);
    expect(keepFileOfPackage('better-sqlite3', 'prebuilds/win32-x64.node', LINUX)).toBe(false);
    expect(keepFileOfPackage('better-sqlite3', 'prebuilds/win32-x64.node', WINDOWS)).toBe(true);
    expect(keepFileOfPackage('better-sqlite3', 'deps/sqlite3/sqlite3.c', WINDOWS)).toBe(false);
    expect(keepFileOfPackage('better-sqlite3', 'build/Release/better_sqlite3.node', LINUX)).toBe(
      true,
    );
    expect(keepFileOfPackage('better-sqlite3', 'build/Makefile', LINUX)).toBe(false);
    expect(keepFileOfPackage('pdfjs-dist', 'legacy/build/pdf.mjs', LINUX)).toBe(true);
    expect(keepFileOfPackage('pdfjs-dist', 'legacy/build/pdf.worker.mjs', LINUX)).toBe(true);
    expect(keepFileOfPackage('pdfjs-dist', 'standard_fonts/FoxitSans.pfb', LINUX)).toBe(true);
    expect(keepFileOfPackage('pdfjs-dist', 'build/pdf.mjs', LINUX)).toBe(false);
    expect(keepFileOfPackage('pdfjs-dist', 'web/pdf_viewer.mjs', LINUX)).toBe(false);
    expect(
      keepFileOfPackage('node-notifier', 'vendor/snoreToast/snoretoast-x64.exe', WINDOWS),
    ).toBe(true);
    expect(keepFileOfPackage('node-notifier', 'vendor/snoreToast/snoretoast-x64.exe', LINUX)).toBe(
      false,
    );
  });

  it('mirrors the repo layout under app/ with run-time manifests and the import shim', () => {
    const root = fixtureRepo();
    write(root, 'server/dist/index.js', 'export {};\n');
    write(root, 'server/dist/index.js.map', '{}');
    write(root, 'web/dist/index.html', '<!doctype html>');
    write(root, 'launcher/tray/second-brain-tray.ps1', '# tray');
    write(root, 'node_modules/c/index.js', 'module.exports = 1;');
    write(root, 'node_modules/c/README.md', '# c');
    const { entries } = collectRuntimeEntries(root, LINUX);
    const paths = entries.map((entry) => entry.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'app/package.json',
        'app/sea-entry.cjs',
        'app/server/package.json',
        'app/server/dist/index.js',
        'app/web/dist/index.html',
        'app/launcher/tray/second-brain-tray.ps1',
        'app/node_modules/c/index.js',
        'app/node_modules/c/node_modules/f/package.json',
        'app/server/node_modules/a/package.json',
      ]),
    );
    expect(paths).not.toContain('app/server/dist/index.js.map');
    expect(paths).not.toContain('app/node_modules/c/README.md');
    expect(paths.filter((p) => p.includes('dev-only') || p.includes('vitest'))).toEqual([]);
    const server = JSON.parse(
      String(entries.find((e) => e.path === 'app/server/package.json')?.data),
    );
    expect(server).toEqual({ name: '@x/server', version: '0.1.0', type: 'module' });
    const shim = String(entries.find((e) => e.path === 'app/sea-entry.cjs')?.data);
    expect(shim).toContain('module.exports = (entry) => import(');
  });
});

describe('the app build the executable packs (F29.1)', () => {
  it('runs npm run build when an output is missing or a source is newer', () => {
    const root = fixtureRepo();
    expect(buildNeededReason(root)).toMatch(/server[\\/]dist[\\/]index\.js is missing/);
    for (const rel of ['server/dist/index.js', 'server/dist/mcp-stdio.js', 'web/dist/index.html']) {
      write(root, rel, 'built');
    }
    write(root, 'server/src/system/x.ts', 'export {};');
    write(root, 'web/src/main.tsx', 'export {};');
    const age = (rel: string, ms: number) => {
      const when = new Date(Date.now() - ms);
      utimesSync(path.join(root, rel), when, when);
    };
    for (const rel of ['server/dist/index.js', 'server/dist/mcp-stdio.js', 'web/dist/index.html']) {
      age(rel, 30_000);
    }
    for (const rel of ['server/src/system/x.ts', 'web/src/main.tsx']) age(rel, 60_000);
    expect(buildNeededReason(root)).toBeNull();
    write(root, 'web/src/main.tsx', 'export const changed = 1;');
    expect(buildNeededReason(root)).toMatch(
      /web[\\/]src[\\/]main\.tsx changed after the last build/,
    );
  });
});
