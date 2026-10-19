import Database from 'better-sqlite3';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { swapDatabase } from '../../src/index/database-swap.js';
import { createBuildDatabase } from '../../src/index/index-database.js';
import { retryTransientSync } from '../../src/index/sync-file-retry.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';
import { createIndexedVault, titles, type IndexedVault } from './helpers/index-test-vault.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(removeDir));

/** A valid index file (schema and all) carrying `marker` in its meta table. */
function indexFile(file: string, marker: string): void {
  const db = createBuildDatabase(file);
  db.prepare("INSERT INTO meta(key, value) VALUES ('marker', ?)").run(marker);
  db.close();
}
const markerOf = (db: Database.Database | null) =>
  db?.prepare("SELECT value FROM meta WHERE key = 'marker'").pluck().get();
const failing = {
  beforeOpenSwapped: () => {
    throw new Error('cannot open');
  },
};
const errno = (code: string) => Object.assign(new Error(code), { code });

describe('retrying file operations on Windows sharing violations', () => {
  it('retries transient errors, then succeeds', () => {
    let calls = 0;
    retryTransientSync(() => {
      calls += 1;
      if (calls < 3) throw errno(calls === 1 ? 'EBUSY' : 'EPERM');
    });
    expect(calls).toBe(3);
  });

  it('gives up after a few attempts and never retries other errors', () => {
    let calls = 0;
    expect(() =>
      retryTransientSync(() => {
        calls += 1;
        throw errno('EBUSY');
      }),
    ).toThrow('EBUSY');
    expect(calls).toBe(8);
    calls = 0;
    expect(() =>
      retryTransientSync(() => {
        calls += 1;
        throw errno('ENOENT');
      }),
    ).toThrow('ENOENT');
    expect(calls).toBe(1);
  });
});

describe('swapping the index file', () => {
  function setup() {
    const dir = makeTempDir('sb swap Đồ án');
    dirs.push(dir);
    return { live: path.join(dir, 'index.sqlite'), build: path.join(dir, 'index.sqlite.building') };
  }

  it('puts the new file in place and removes stale side files of the old one', () => {
    const { live, build } = setup();
    indexFile(live, 'old');
    indexFile(build, 'new');
    writeFileSync(`${live}-wal`, 'stale write-ahead log');
    writeFileSync(`${live}-shm`, 'stale shared memory');
    const current = new Database(live);
    const result = swapDatabase(build, live, current);
    expect(result.swapped).toBe(true);
    expect(markerOf(result.db)).toBe('new');
    expect(current.open).toBe(false);
    expect(existsSync(build)).toBe(false);
    expect(existsSync(`${live}.previous`)).toBe(false);
    result.db?.close();
  });

  it('brings the previous index back when the new file cannot be opened', () => {
    const { live, build } = setup();
    indexFile(live, 'old');
    indexFile(build, 'new');
    const result = swapDatabase(build, live, new Database(live), failing);
    expect(result.swapped).toBe(false);
    expect(markerOf(result.db)).toBe('old');
    expect(existsSync(`${live}.previous`)).toBe(false);
    result.db?.close();
  });

  it('without a previous index, discards the file that failed to open', () => {
    const { live, build } = setup();
    indexFile(build, 'new');
    const result = swapDatabase(build, live, null, failing);
    expect(result).toMatchObject({ swapped: false, db: null });
    expect(existsSync(live)).toBe(false);
  });
});

describe('the index service when the rebuilt file cannot be opened', () => {
  let v: IndexedVault | null = null;
  afterEach(async () => {
    await v?.cleanup();
    v = null;
  });

  it('keeps answering from the previous index and reports a warning', async () => {
    let fail = false;
    const warnings: string[] = [];
    v = await createIndexedVault({
      files: { '2 Areas/Giải tích 1.md': 'Đạo hàm.\n' },
      faults: {
        beforeOpenSwapped: () => {
          if (fail) throw new Error('disk gone');
        },
      },
      onWarning: (message) => warnings.push(message),
    });
    fail = true;
    await expect(v.index.rebuild()).rejects.toThrow('disk gone');
    expect(warnings.some((w) => w.includes('could not be put in place'))).toBe(true);
    expect(titles(v.index.search({ q: 'dao ham' }))).toEqual(['Giải tích 1']);
    expect(v.index.getNote('2 Areas/Giải tích 1.md')?.title).toBe('Giải tích 1');
    fail = false;
    await v.index.rebuild();
    expect(titles(v.index.search({ q: 'dao ham' }))).toEqual(['Giải tích 1']);
  });

  it('a first open that cannot open its new file fails cleanly; the next open rebuilds', async () => {
    v = await createIndexedVault({ files: { '0 Inbox/A.md': 'a\n' } });
    v.index.close();
    const db = path.join(v.vault.paths.cacheDir, 'index.sqlite');
    writeFileSync(db, 'garbage '.repeat(50));
    await expect(v.reopen({ faults: failing })).rejects.toThrow('cannot open');
    expect(existsSync(db)).toBe(false);
    const index = await v.reopen({ faults: {} });
    expect(await index.open()).toEqual({ rebuilt: true, reason: 'missing' });
  });
});
