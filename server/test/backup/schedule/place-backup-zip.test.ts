import {
  lutimesSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  emptyRecord,
  MAX_RUNS,
  openBackupRecords,
  trimRuns,
} from '../../../src/backup/schedule/backup-records.js';
import { placeBackupZip } from '../../../src/backup/schedule/place-backup-zip.js';
import { removeStaleBackupTemps } from '../../../src/backup/schedule/stale-backup-temps.js';
import type { BackupRun } from '../../../src/backup/schedule/schedule-types.js';
import { createMemoryLogger } from '../../api/vault-test-app.js';
import { makeTempDir, removeDir } from '../../helpers/test-environment.js';

let folder: string;
beforeEach(() => {
  folder = path.join(makeTempDir('sb đặt zip'), 'Sao lưu');
  mkdirSync(folder);
});
afterEach(() => removeDir(path.dirname(folder)));

const name = (n: number) => `Second Brain Kho 2026-10-22 2100${n > 1 ? ` (${n})` : ''}.zip`;

function failingSource(afterBytes: number, code: string): Readable {
  let sent = false;
  return new Readable({
    read() {
      if (!sent) {
        sent = true;
        this.push(Buffer.alloc(afterBytes, 1));
      } else this.destroy(Object.assign(new Error('write failed'), { code }));
    },
  });
}

describe('placing a backup zip in its folder atomically (F27.1)', () => {
  it('a failure while writing leaves neither a partial zip nor a temp file', async () => {
    await expect(
      placeBackupZip(failingSource(64 * 1024, 'ENOSPC'), folder, name),
    ).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(readdirSync(folder)).toEqual([]);
  });

  it('a failure after the bytes are written (before the name is taken) leaves nothing', async () => {
    await expect(
      placeBackupZip(Readable.from([Buffer.from('zip')]), folder, name, {
        beforeLink: () => {
          throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        },
      }),
    ).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(readdirSync(folder)).toEqual([]);
  });

  it('never replaces a file: a taken name gets " (2)", also without hard links', async () => {
    writeFileSync(path.join(folder, name(1)), 'hers');
    const first = await placeBackupZip(Readable.from([Buffer.from('one')]), folder, name);
    expect(path.basename(first.file)).toBe(name(2));
    const noLinks = {
      link: () => Promise.reject(Object.assign(new Error('no links'), { code: 'EPERM' })),
    };
    const second = await placeBackupZip(
      Readable.from([Buffer.from('two!')]),
      folder,
      name,
      noLinks,
    );
    expect(path.basename(second.file)).toBe(name(3));
    expect(second.bytes).toBe(4);
    expect(readFileSync(path.join(folder, name(1)), 'utf8')).toBe('hers');
    expect(readdirSync(folder).sort()).toEqual([name(1), name(2), name(3)].sort());
  });
});

describe('drives without hard links (F27.1: a FAT32/exFAT USB stick, SMB shares)', () => {
  // Windows maps CreateHardLinkW's ERROR_INVALID_FUNCTION on FAT/exFAT to EISDIR; shares answer
  // EINVAL; other systems EPERM, EXDEV, ENOTSUP. All of them mean "no hard links here".
  it.each(['EISDIR', 'EINVAL', 'EPERM', 'EXDEV', 'ENOTSUP', 'EIO'])(
    '(F27.1) link failing with %s falls back to check-then-rename and places the zip',
    async (code) => {
      writeFileSync(path.join(folder, name(1)), 'hers');
      let calls = 0;
      const placed = await placeBackupZip(Readable.from([Buffer.from('zip bytes')]), folder, name, {
        link: () => {
          calls += 1;
          return Promise.reject(Object.assign(new Error(`${code}: link`), { code }));
        },
      });
      expect(path.basename(placed.file)).toBe(name(2));
      expect(readFileSync(placed.file, 'utf8')).toBe('zip bytes');
      expect(readFileSync(path.join(folder, name(1)), 'utf8')).toBe('hers'); // never replaced
      expect(readdirSync(folder).sort()).toEqual([name(1), name(2)].sort()); // no temp file left
      expect(calls).toBe(1); // tried once, then the drive is known to have none
    },
  );
});

describe('temp files left by a crashed run (F27.1)', () => {
  it("only the app's own stale temp files go: fresh ones, folders, links and her files stay", async () => {
    const now = new Date();
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
    const file = (n: string, age: number) => {
      writeFileSync(path.join(folder, n), 'x');
      utimesSync(path.join(folder, n), hoursAgo(age), hoursAgo(age));
    };
    file('.sb-0123456789ab.tmp', 7); // crashed 7 h ago
    file('.sb-ba9876543210.tmp', 1); // a run of another process may still write it
    file('.sb-ghost.tmp', 9); // not the app's name shape
    file('Ghi chú.tmp', 9);
    mkdirSync(path.join(folder, '.sb-aaaaaaaaaaaa.tmp'));
    utimesSync(path.join(folder, '.sb-aaaaaaaaaaaa.tmp'), hoursAgo(9), hoursAgo(9));
    const kept = ['.sb-aaaaaaaaaaaa.tmp', '.sb-ba9876543210.tmp', '.sb-ghost.tmp', 'Ghi chú.tmp'];
    if (process.platform !== 'win32') {
      // A link with the app's name shape: never followed, never removed.
      symlinkSync(path.join(folder, 'Ghi chú.tmp'), path.join(folder, '.sb-bbbbbbbbbbbb.tmp'));
      lutimesSync(path.join(folder, '.sb-bbbbbbbbbbbb.tmp'), hoursAgo(9), hoursAgo(9));
      kept.push('.sb-bbbbbbbbbbbb.tmp');
    }
    expect(await removeStaleBackupTemps(folder, now)).toBe(1);
    expect(readdirSync(folder).sort()).toEqual(kept.sort());
    expect(await removeStaleBackupTemps(path.join(folder, 'missing'), now)).toBe(0);
  });
});

describe('backups.json records (F27.1)', () => {
  it('per vault id, kept atomically; a garbled file is kept aside and starts empty', async () => {
    const file = path.join(folder, 'backups.json');
    const logger = createMemoryLogger();
    const records = openBackupRecords({ file, now: () => new Date(2026, 9, 22), logger });
    await records.update('vault-a', (r) => (r.lastSuccessAt = '2026-10-22T14:00:00.000Z'));
    await records.update('vault-b', (r) => (r.retryAt = '2026-10-22T15:00:00.000Z'));
    expect((await records.read('vault-a')).lastSuccessAt).toBe('2026-10-22T14:00:00.000Z');
    expect((await records.read('vault-b')).retryAt).toBe('2026-10-22T15:00:00.000Z');
    expect(await records.read('vault-c')).toEqual(emptyRecord());

    writeFileSync(file, '{ not json');
    expect(await records.read('vault-a')).toEqual(emptyRecord());
    // A read (GET /api/backup/schedule) never changes the disk; the next write keeps a copy.
    expect(readdirSync(folder).some((n) => n.startsWith('backups.json.corrupt-'))).toBe(false);
    await records.update('vault-a', (r) => (r.lastAttemptAt = '2026-10-22T16:00:00.000Z'));
    expect(readdirSync(folder).some((n) => n.startsWith('backups.json.corrupt-'))).toBe(true);
    expect(logger.lines.some((l) => l.includes('unreadable'))).toBe(true);
  });

  it('the run list is bounded but never forgets a zip that is still on disk', () => {
    const run = (i: number, ok: boolean, removed = false): BackupRun => ({
      at: new Date(2026, 0, 1 + i).toISOString(),
      kind: 'scheduled',
      file: ok ? `/b/${i}.zip` : null,
      bytes: 1,
      ok,
      ...(removed ? { removed } : {}),
    });
    const runs = [run(0, true), ...Array.from({ length: 100 }, (_, i) => run(i + 1, false))];
    const trimmed = trimRuns(runs);
    expect(trimmed).toHaveLength(MAX_RUNS);
    expect(trimmed[0]).toEqual(run(0, true)); // the oldest, still on disk
    expect(trimmed.at(-1)).toEqual(run(100, false));
  });
});
