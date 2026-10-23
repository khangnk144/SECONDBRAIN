// Payload format, runtime folder extraction, damage repair and cleanup of the executable (F29.1).
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { seaConfig, transpileBootstrap } from './lib/build-exe/make-sea.js';
import { packPayload } from './lib/build-exe/payload-pack.js';
import { failureCode, serverArguments } from './lib/build-exe/sea-bootstrap.js';
import {
  cleanupRuntimes,
  cleanupRuntimesSafely,
  ensureRuntime,
  isCheckedByContent,
  isRuntimeValid,
  MARKER_FILE,
  markInUse,
  runtimeRoot,
  unpackPayload,
} from './lib/build-exe/sea-runtime-store.js';
import { appRoot } from './lib/script-utils.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const temp = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sb runtime Đồ án '));
  dirs.push(dir);
  return dir;
};

const ENTRIES = [
  { path: 'app/server/dist/index.js', data: Buffer.from('export const x = 1;\n') },
  { path: 'app/node_modules/tool/bin/run', data: Buffer.from('#!/bin/sh\n'), executable: true },
  { path: 'app/1 Projects/Đồ án Giải tích.md', data: Buffer.from('# Đồ án\n') },
  { path: 'app/empty.txt', data: Buffer.alloc(0) },
];

describe('payload format (F29.1)', () => {
  it('round-trips every byte and the executable bit; same input, same hash', () => {
    const packed = packPayload(ENTRIES);
    expect(packPayload([...ENTRIES].reverse()).hash).toBe(packed.hash);
    expect(packed.files).toBe(4);
    const dir = path.join(temp(), 'runtime');
    unpackPayload(packed.payload, packed.hash, dir);
    for (const entry of ENTRIES) {
      expect(readFileSync(path.join(dir, ...entry.path.split('/')))).toEqual(entry.data);
    }
    if (process.platform !== 'win32') {
      expect(statSync(path.join(dir, 'app/node_modules/tool/bin/run')).mode & 0o111).not.toBe(0);
    }
    expect(isRuntimeValid(dir, packed.hash)).toBe(true);
  });

  it('refuses a payload whose hash does not match and paths that leave the folder', () => {
    const packed = packPayload(ENTRIES);
    const damaged = Buffer.from(packed.payload);
    const at = damaged.length - 10;
    damaged.writeUInt8(damaged.readUInt8(at) ^ 0xff, at);
    expect(() => unpackPayload(damaged, packed.hash, path.join(temp(), 'x'))).toThrow(
      'PAYLOAD_HASH',
    );
    const evil = packPayload([{ path: 'app/../../outside.txt', data: Buffer.from('x') }]);
    const root = temp();
    expect(() => unpackPayload(evil.payload, evil.hash, path.join(root, 'r'))).toThrow(
      'PAYLOAD_PATH',
    );
    expect(existsSync(path.join(root, 'outside.txt'))).toBe(false);
    expect(() => packPayload([ENTRIES[0]!, ENTRIES[0]!])).toThrow('Duplicate');
  });
});

describe('runtime folder (F29.1)', () => {
  it('resolves %LOCALAPPDATA% on Windows and XDG_DATA_HOME or ~/.local/share elsewhere', () => {
    expect(
      runtimeRoot(
        'win32',
        { LOCALAPPDATA: 'C:\\Users\\Khang\\AppData\\Local' },
        'C:\\Users\\Khang',
      ),
    ).toBe('C:\\Users\\Khang\\AppData\\Local\\SecondBrain\\runtime');
    expect(runtimeRoot('win32', {}, 'C:\\Users\\Khang')).toBe(
      'C:\\Users\\Khang\\AppData\\Local\\SecondBrain\\runtime',
    );
    expect(runtimeRoot('linux', { XDG_DATA_HOME: '/data/xdg' }, '/home/k')).toBe(
      '/data/xdg/second-brain/runtime',
    );
    expect(runtimeRoot('linux', { XDG_DATA_HOME: 'relative' }, '/home/k')).toBe(
      '/home/k/.local/share/second-brain/runtime',
    );
  });

  it('extracts once, reuses a valid folder and re-extracts a damaged one', () => {
    const packed = packPayload(ENTRIES);
    const root = temp();
    let reads = 0;
    const read = () => {
      reads += 1;
      return packed.payload;
    };
    const dir = ensureRuntime(root, packed.hash, read);
    expect(path.basename(dir)).toBe(packed.hash.slice(0, 16));
    expect(ensureRuntime(root, packed.hash, read)).toBe(dir);
    expect(reads).toBe(1);
    const entry = path.join(dir, 'app', 'server', 'dist', 'index.js');
    rmSync(entry); // a file deleted by hand or by a cleaner
    expect(ensureRuntime(root, packed.hash, read)).toBe(dir);
    expect(readFileSync(entry, 'utf8')).toBe('export const x = 1;\n');
    writeFileSync(entry, 'changed'); // other size
    expect(ensureRuntime(root, packed.hash, read)).toBe(dir);
    expect(reads).toBe(3);
    expect(readFileSync(entry, 'utf8')).toBe('export const x = 1;\n');
  });

  it('(F29.1) a damaged file of the same size in the server code is found by its hash and re-extracted', () => {
    const packed = packPayload(ENTRIES);
    const root = temp();
    let reads = 0;
    const read = () => {
      reads += 1;
      return packed.payload;
    };
    const dir = ensureRuntime(root, packed.hash, read);
    const entry = path.join(dir, 'app', 'server', 'dist', 'index.js');
    writeFileSync(entry, 'export const x = 2;\n'); // same size, other bytes
    expect(isRuntimeValid(dir, packed.hash)).toBe(false);
    expect(ensureRuntime(root, packed.hash, read)).toBe(dir);
    expect(reads).toBe(2);
    expect(readFileSync(entry, 'utf8')).toBe('export const x = 1;\n');
    // A marker of an older build (sizes only) is not trusted: one fresh extraction.
    const marker = JSON.parse(readFileSync(path.join(dir, MARKER_FILE), 'utf8'));
    marker.files = marker.files.map(([rel, size]: [string, number]) => [rel, size]);
    writeFileSync(path.join(dir, MARKER_FILE), JSON.stringify(marker));
    expect(isRuntimeValid(dir, packed.hash)).toBe(false);
    expect(isCheckedByContent('app/server/dist/index.js')).toBe(true);
    expect(isCheckedByContent('app/node_modules/better-sqlite3/build/Release/x.node')).toBe(true);
    expect(isCheckedByContent('app/sea-entry.cjs')).toBe(true);
    expect(isCheckedByContent('app/web/dist/index.html')).toBe(false);
  });

  it('cleanup never throws: a runtime root that is gone, a marker that cannot be removed', () => {
    const root = temp();
    mkdirSync(path.join(root, 'keep'));
    // A "marker" that rmSync({ force }) cannot remove (stands in for EPERM/EBUSY on Windows).
    mkdirSync(path.join(root, 'locked', '.users', '999999'), { recursive: true });
    writeFileSync(path.join(root, 'locked', '.users', '999999', 'x'), '');
    expect(cleanupRuntimes(root, path.join(root, 'keep'), () => false)).toEqual([]);
    expect(existsSync(path.join(root, 'locked'))).toBe(true); // kept: it could still be in use
    expect(cleanupRuntimes(path.join(root, 'missing'), 'x')).toEqual([]);
    expect(cleanupRuntimesSafely(path.join(root, 'missing'), 'x')).toEqual([]);
  });

  it('two starts racing: the one that loses the rename uses the winner and removes its copy', () => {
    const packed = packPayload(ENTRIES);
    const root = temp();
    const final = path.join(root, packed.hash.slice(0, 16));
    // While this start extracts, another one finishes first.
    const dir = ensureRuntime(root, packed.hash, () => {
      unpackPayload(packed.payload, packed.hash, final);
      return packed.payload;
    });
    expect(dir).toBe(final);
    expect(isRuntimeValid(final, packed.hash)).toBe(true);
    expect(readdir(root)).toEqual([path.basename(final)]);
  });

  it('cleanup removes other hashes nobody uses, keeps used ones and fresh temp folders', () => {
    const root = temp();
    const make = (name: string) => mkdirSync(path.join(root, name, 'app'), { recursive: true });
    for (const name of ['current', 'old', 'used', 'old.tmp-1-a', 'new.tmp-2-b']) make(name);
    markInUse(path.join(root, 'used'), 111);
    markInUse(path.join(root, 'old'), 222); // a crashed process: pid gone
    const hourAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(path.join(root, 'old.tmp-1-a'), hourAgo, hourAgo);
    const removed = cleanupRuntimes(root, path.join(root, 'current'), (pid) => pid === 111);
    expect(removed.sort()).toEqual(['old', 'old.tmp-1-a']);
    expect(readdir(root)).toEqual(['current', 'new.tmp-2-b', 'used']);
  });
});

const readdir = (dir: string) => readdirSync(dir).sort();

describe('bootstrap hand-over (F29.1)', () => {
  it('adds --home <exe folder> unless a home is given', () => {
    const exe = '/opt/Second Brain/second-brain';
    expect(serverArguments(['--login'], exe, {})).toEqual([
      '--login',
      '--home',
      '/opt/Second Brain',
    ]);
    expect(serverArguments(['--home', '/x'], exe, {})).toEqual(['--home', '/x']);
    expect(serverArguments(['--home=/x'], exe, {})).toEqual(['--home=/x']);
    expect(serverArguments([], exe, { SB_HOME: '/y' })).toEqual([]);
  });

  it('reports codes only, never a message that could name a folder', () => {
    expect(failureCode(Object.assign(new Error('EACCES: /home/khang/x'), { code: 'EACCES' }))).toBe(
      'EACCES',
    );
    expect(failureCode(new Error('PAYLOAD_HASH'))).toBe('PAYLOAD_HASH');
    expect(failureCode(new Error('Cannot find /home/khang'))).toBe('UNKNOWN');
  });

  it('is one CommonJS file that requires Node built-ins only; SEA config without snapshot', () => {
    const source = transpileBootstrap(path.join(appRoot, 'scripts/lib/build-exe/sea-bootstrap.ts'));
    const required = [...source.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
    expect(required.length).toBeGreaterThan(5);
    expect(required.every((name) => name?.startsWith('node:'))).toBe(true);
    expect(source).toContain('isSea)()');
    expect(source).toContain('const __seaRuntimeStore = (() => {');
    // The delayed cleanup runs in the server's process: only the variant that never throws.
    expect(source).toMatch(/cleanupRuntimesSafely\)\(root, dir\)/);
    expect(source).not.toMatch(/\.cleanupRuntimes\)\(root, dir\)/);
    expect(source).not.toContain('require("./sea-runtime-store');
    expect(source).not.toMatch(/^import /m);
    expect(seaConfig('/stage')).toMatchObject({
      useSnapshot: false,
      useCodeCache: false,
      disableExperimentalSEAWarning: true,
      assets: { 'payload.bin': path.join('/stage', 'payload.bin') },
    });
  });
});
