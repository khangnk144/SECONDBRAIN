import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyRetention } from '../../../src/backup/schedule/backup-retention.js';
import {
  isScheduledBackupName,
  scheduledBackupName,
} from '../../../src/backup/schedule/scheduled-backup-name.js';
import type { BackupRun } from '../../../src/backup/schedule/schedule-types.js';
import { makeTempDir, removeDir } from '../../helpers/test-environment.js';

let root: string;
let folder: string;
beforeEach(() => {
  root = makeTempDir('sb sao lưu Đồ án');
  folder = path.join(root, 'Bản sao lưu');
  mkdirSync(folder);
});
afterEach(() => removeDir(root));

/** A zip the app made on day `day` of October 2026 (recorded run + file of that size). */
function appZip(day: number, dir = folder): BackupRun {
  const at = new Date(2026, 9, day, 21, 0);
  const file = path.join(dir, scheduledBackupName('Kho Ghi chú', at));
  const bytes = Buffer.from(`zip ${day}`);
  writeFileSync(file, bytes);
  return { at: at.toISOString(), kind: 'scheduled', file, bytes: bytes.length, ok: true };
}

describe('retention keeps the newest N of the app own backups only (F27.3)', () => {
  it('(F27.3) deletes the oldest recorded zips beyond keep and leaves foreign files alone', async () => {
    const runs = [1, 2, 3, 4, 5].map((day) => appZip(day));
    // Her own files in the same folder, one with the app's naming shape but never recorded.
    writeFileSync(path.join(folder, 'Ghi chú riêng.txt'), 'của tôi');
    writeFileSync(path.join(folder, 'Second Brain Kho Ghi chú 2026-09-01 2100.zip'), 'tự tạo');
    writeFileSync(path.join(folder, 'other.zip'), 'x');

    const result = await applyRetention(runs, folder, 3);
    expect(result.deleted.map((f) => path.basename(f))).toEqual([
      'Second Brain Kho Ghi chú 2026-10-02 2100.zip',
      'Second Brain Kho Ghi chú 2026-10-01 2100.zip',
    ]);
    expect(readdirSync(folder).sort()).toEqual(
      [
        'Ghi chú riêng.txt',
        'Second Brain Kho Ghi chú 2026-09-01 2100.zip',
        'Second Brain Kho Ghi chú 2026-10-03 2100.zip',
        'Second Brain Kho Ghi chú 2026-10-04 2100.zip',
        'Second Brain Kho Ghi chú 2026-10-05 2100.zip',
        'other.zip',
      ].sort(),
    );
    expect(runs.filter((r) => r.removed).map((r) => r.at)).toEqual([runs[0]?.at, runs[1]?.at]);
  });

  it('(F27.3) a zip she renamed, one replaced by another file and one in another folder are kept', async () => {
    const runs = [1, 2, 3, 4].map((day) => appZip(day));
    const renamed = runs[0] as BackupRun;
    const kept = path.join(folder, 'Giữ lại – trước kỳ thi.zip');
    writeFileSync(kept, 'zip 1'); // same bytes as the original, new name
    rmSync(renamed.file as string);
    const replaced = runs[1] as BackupRun;
    writeFileSync(replaced.file as string, 'a different, longer file now');
    const elsewhere = path.join(root, 'USB cũ');
    mkdirSync(elsewhere);
    const old = appZip(1, elsewhere); // recorded, but the folder is not the configured one

    const result = await applyRetention([old, ...runs], folder, 1);
    expect(result.deleted.map((f) => path.basename(f))).toEqual([
      'Second Brain Kho Ghi chú 2026-10-03 2100.zip',
    ]);
    expect(existsSync(kept)).toBe(true);
    expect(existsSync(replaced.file as string)).toBe(true);
    expect(existsSync(old.file as string)).toBe(true);
    expect(old.removed).toBeUndefined();
    // The renamed and the replaced runs are no longer ours: forgotten, never deleted later.
    expect(renamed.removed).toBe(true);
    expect(replaced.removed).toBe(true);
    expect(result.forgotten).toHaveLength(2);
  });

  it('a recorded run whose name no longer has the scheduled shape is never deleted', async () => {
    const odd = path.join(folder, 'Second Brain đổi tên.zip');
    writeFileSync(odd, 'zip');
    const run: BackupRun = {
      at: new Date(2026, 9, 1).toISOString(),
      kind: 'manual',
      file: odd,
      bytes: 3,
      ok: true,
    };
    const result = await applyRetention([run, appZip(2), appZip(3)], folder, 1);
    expect(existsSync(odd)).toBe(true);
    expect(result.deleted).toHaveLength(1);
  });

  it('names: vault folder name sanitized, suffix for a taken name, pattern recognises both', () => {
    const at = new Date(2026, 9, 22, 21, 5);
    expect(scheduledBackupName('Đồ án: "Giải tích"?', at)).toBe(
      'Second Brain Đồ án Giải tích 2026-10-22 2105.zip',
    );
    expect(scheduledBackupName('...', at, 3)).toBe('Second Brain vault 2026-10-22 2105 (3).zip');
    expect(isScheduledBackupName('Second Brain vault 2026-10-22 2105 (3).zip')).toBe(true);
    expect(isScheduledBackupName('Second Brain vault 2026-10-22 2105 copy.zip')).toBe(false);
    expect(isScheduledBackupName('second-brain-sao-luu-2026-10-22-2105.zip')).toBe(false);
  });
});
