import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKUP_LOCK_FILE } from '../../../src/backup/schedule/backup-run-lock.js';
import { makeClock } from '../../index/helpers/index-test-vault.js';
import { createVaultTestApp, type VaultTestApp } from '../../api/vault-test-app.js';
import {
  at,
  backupsFolder,
  recordsOf,
  startSchedule,
  tick,
  waitIdle,
  zipEntries,
  zipsIn,
} from './schedule-test-host.js';

let t: VaultTestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup(start: Date) {
  const clock = makeClock(start);
  t = await createVaultTestApp(47861, { now: clock.now, watcher: false });
  t.settings.backup.schedule.enabled = true;
  await t.context.vault.create('1 Projects/Đồ án Giải tích.md', '# Đồ án\n');
  await t.context.settled();
  return { clock, t };
}

describe('scheduled backups at the configured time (F27.1)', () => {
  it('(F27.1) at 21:00 writes the export zip as "Second Brain <vault> <date time>.zip" and records it', async () => {
    const { clock, t } = await setup(at(2026, 10, 22, 20, 58));
    // Off by default: nothing at all happens while it is off.
    t.settings.backup.schedule.enabled = false;
    const s = await startSchedule(t, { now: clock.now });
    clock.set(at(2026, 10, 22, 21, 0));
    await tick(s);
    expect(zipsIn(backupsFolder(t))).toEqual([]);

    t.settings.backup.schedule.enabled = true;
    clock.set(at(2026, 10, 22, 20, 59));
    await tick(s);
    expect(zipsIn(backupsFolder(t))).toEqual([]);
    clock.set(at(2026, 10, 22, 21, 0));
    await tick(s);
    expect(zipsIn(backupsFolder(t))).toEqual(['Second Brain vault 2026-10-22 2100.zip']);
    // Same content as "Xuất bản sao lưu…": notes and state in, cache out, never settings.
    const entries = zipEntries(
      path.join(backupsFolder(t), 'Second Brain vault 2026-10-22 2100.zip'),
    );
    expect(entries).toContain('1 Projects/Đồ án Giải tích.md');
    expect(entries.some((e) => e.startsWith('.secondbrain/state/'))).toBe(true);
    expect(entries.some((e) => e.startsWith('.secondbrain/cache'))).toBe(false);
    expect(entries.some((e) => e.endsWith('settings.json'))).toBe(false);

    const record = recordsOf(t).vaults[t.context.vault.id];
    expect(record?.runs.map((r) => [r.kind, r.ok])).toEqual([['scheduled', true]]);
    expect(record?.lastSuccessAt).toBe(at(2026, 10, 22, 21, 0).toISOString());
    // A second beat in the same minute and the rest of the evening: nothing more.
    for (const minute of [1, 30]) {
      clock.set(at(2026, 10, 22, 21, minute));
      await tick(s);
    }
    expect(zipsIn(backupsFolder(t))).toHaveLength(1);
    const status = await s.service.status();
    expect(status).toMatchObject({
      enabled: true,
      folder: backupsFolder(t),
      isDefaultFolder: true,
      nextRunAt: at(2026, 10, 23, 21, 0).toISOString(),
      lastSuccess: { fileName: 'Second Brain vault 2026-10-22 2100.zip', ok: true },
    });
    expect(status.lastSuccess?.bytes).toBeGreaterThan(100);
  });

  it('(F27.3) keeps the newest N scheduled zips of the day after day runs', async () => {
    // Started minutes before the time: the first run is the one at 21:00 (no extra catch-up).
    const { clock, t } = await setup(at(2026, 10, 1, 20, 50));
    t.settings.backup.schedule.keep = 3;
    const s = await startSchedule(t, { now: clock.now });
    mkdirSync(backupsFolder(t));
    writeFileSync(path.join(backupsFolder(t), 'của tôi.zip'), 'hers');
    for (let day = 1; day <= 5; day += 1) {
      clock.set(at(2026, 10, day, 21, 0));
      await tick(s);
    }
    expect(zipsIn(backupsFolder(t))).toEqual([
      'Second Brain vault 2026-10-03 2100.zip',
      'Second Brain vault 2026-10-04 2100.zip',
      'Second Brain vault 2026-10-05 2100.zip',
      'của tôi.zip',
    ]);
  });
});

describe('missed times, failures and one run at a time (F27.2)', () => {
  it('(F27.2) a start after the machine was off catches up once; a restart repeats nothing', async () => {
    const { clock, t } = await setup(at(2026, 10, 22, 23, 15));
    const first = await startSchedule(t, { now: clock.now }); // the start check is the catch-up
    expect(zipsIn(backupsFolder(t))).toEqual(['Second Brain vault 2026-10-22 2315.zip']);
    expect(recordsOf(t).vaults[t.context.vault.id]?.runs[0]?.kind).toBe('catch-up');
    await first.service.close();

    clock.set(at(2026, 10, 22, 23, 40));
    const second = await startSchedule(t, { now: clock.now });
    await tick(second);
    expect(zipsIn(backupsFolder(t))).toHaveLength(1);
    // Next evening at 21:00 (less than 24 h after the catch-up) it runs on time again.
    clock.set(at(2026, 10, 23, 21, 0));
    await tick(second);
    expect(zipsIn(backupsFolder(t))).toHaveLength(2);
  });

  it('(F27.2) a morning start after an evening off catches up at once (last success 35 h old)', async () => {
    const { clock, t } = await setup(at(2026, 10, 20, 8, 0));
    const sunday = at(2026, 10, 18, 21, 0).toISOString();
    mkdirSync(path.join(t.home, '.secondbrain'), { recursive: true });
    writeFileSync(
      path.join(t.home, '.secondbrain', 'backups.json'),
      JSON.stringify({
        version: 1,
        vaults: {
          [t.context.vault.id]: {
            runs: [],
            lastSuccessAt: sunday,
            lastAttemptAt: sunday,
            retryAt: null,
            push: null,
          },
        },
      }),
    );
    const s = await startSchedule(t, { now: clock.now }); // Tuesday 08:00
    expect(zipsIn(backupsFolder(t))).toEqual(['Second Brain vault 2026-10-20 0800.zip']);
    expect(recordsOf(t).vaults[t.context.vault.id]?.runs.map((r) => r.kind)).toEqual(['catch-up']);
    expect((await s.service.status()).nextRunAt).toBe(at(2026, 10, 20, 21, 0).toISOString());
    clock.set(at(2026, 10, 20, 12, 0));
    await tick(s);
    expect(zipsIn(backupsFolder(t))).toHaveLength(1);
    clock.set(at(2026, 10, 20, 21, 0));
    await tick(s);
    expect(zipsIn(backupsFolder(t))).toHaveLength(2);
  });

  it('(F27.2) the first backup ever runs at the first start, even in the morning', async () => {
    const { clock, t } = await setup(at(2026, 10, 20, 8, 0));
    await startSchedule(t, { now: clock.now });
    expect(zipsIn(backupsFolder(t))).toEqual(['Second Brain vault 2026-10-20 0800.zip']);
  });

  it('(F27.1) a temp file left by a run that crashed hours ago is removed by the next run', async () => {
    const { clock, t } = await setup(at(2026, 10, 22, 20, 50));
    const s = await startSchedule(t, { now: clock.now });
    mkdirSync(backupsFolder(t), { recursive: true });
    const crashed = path.join(backupsFolder(t), '.sb-0123456789ab.tmp');
    const writing = path.join(backupsFolder(t), '.sb-ba9876543210.tmp');
    for (const [file, hours] of [
      [crashed, 7],
      [writing, 1],
    ] as const) {
      writeFileSync(file, 'half a zip');
      const when = new Date(at(2026, 10, 22, 21, 0).getTime() - hours * 3_600_000);
      utimesSync(file, when, when);
    }
    clock.set(at(2026, 10, 22, 21, 0));
    await tick(s);
    expect(existsSync(crashed)).toBe(false);
    expect(existsSync(writing)).toBe(true);
    expect(zipsIn(backupsFolder(t))).toEqual(['Second Brain vault 2026-10-22 2100.zip']);
  });

  it('(F27.2) a missing folder is an error in the status, logged, and retried after 1 h', async () => {
    const { clock, t } = await setup(at(2026, 10, 22, 20, 0));
    const usb = path.join(t.home, 'USB Sao lưu');
    t.settings.backup.schedule.folder = usb;
    const s = await startSchedule(t, { now: clock.now });
    clock.set(at(2026, 10, 22, 21, 0));
    await tick(s);
    let status = await s.service.status();
    expect(status.lastRun).toMatchObject({ ok: false, error: 'folder-missing' });
    expect(status.retryAt).toBe(at(2026, 10, 22, 22, 0).toISOString());
    expect(s.logger.lines.some((l) => l.includes('Scheduled backup failed (folder-missing'))).toBe(
      true,
    );
    expect(s.logger.lines.join('\n')).not.toContain(usb);

    mkdirSync(usb);
    clock.set(at(2026, 10, 22, 21, 30));
    await tick(s);
    expect(zipsIn(usb)).toEqual([]); // not before the hour is over
    clock.set(at(2026, 10, 22, 22, 0));
    await tick(s);
    expect(zipsIn(usb)).toEqual(['Second Brain vault 2026-10-22 2200.zip']);
    status = await s.service.status();
    expect(status.lastRun).toMatchObject({ kind: 'retry', ok: true });
    expect(status.retryAt).toBeNull();
  });

  it('(F27.2) a full disk at the end leaves no partial zip and says so', async () => {
    const { clock, t } = await setup(at(2026, 10, 22, 21, 0));
    const s = await startSchedule(t, {
      now: clock.now,
      placeHooks: {
        beforeLink: () => {
          throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
        },
      },
    });
    expect((await s.service.status()).lastRun).toMatchObject({ ok: false, error: 'disk-full' });
    expect(zipsIn(backupsFolder(t))).toEqual([]);
  });

  it('(F27.2) never two at once: a manual run during a run, or a live lock of another process', async () => {
    const { clock, t } = await setup(at(2026, 10, 22, 12, 0));
    t.settings.backup.schedule.enabled = false; // manual runs only (no first catch-up at start)
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const s = await startSchedule(t, { now: clock.now, placeHooks: { beforeLink: () => gate } });
    const running = s.service.runNow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await s.service.runNow()).toEqual({ ok: false, run: null, error: 'busy' });
    release();
    expect((await running).ok).toBe(true);

    // Another process (alive: our parent) holds the install's lock file.
    const lock = path.join(t.home, '.secondbrain', BACKUP_LOCK_FILE);
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, at: clock.now().toISOString() }));
    expect(await s.service.runNow()).toEqual({ ok: false, run: null, error: 'busy' });
    // A lock left by a process that is gone is taken over.
    writeFileSync(lock, JSON.stringify({ pid: 2_147_483_000, at: clock.now().toISOString() }));
    expect((await s.service.runNow()).ok).toBe(true);
    expect(zipsIn(backupsFolder(t))).toHaveLength(2);
  });

  it('a vault switch closes the plugin of the old vault; each vault keeps its own record', async () => {
    const { clock, t } = await setup(at(2026, 10, 22, 12, 0));
    t.settings.backup.schedule.enabled = false; // manual runs only (no first catch-up at start)
    const a = await startSchedule(t, { now: clock.now });
    expect((await a.service.runNow()).ok).toBe(true);
    const idA = t.context.vault.id;
    await a.service.close();
    expect(await a.service.runNow()).toMatchObject({ ok: false, error: 'busy' });

    const other = path.join(t.home, 'Kho thứ hai');
    mkdirSync(other);
    await t.host.switchTo(other);
    const b = await startSchedule(t, { now: clock.now });
    expect((await b.service.runNow()).ok).toBe(true);
    await waitIdle(b.service);
    const records = recordsOf(t).vaults;
    expect(Object.keys(records).sort()).toEqual([idA, t.context.vault.id].sort());
    expect(zipsIn(backupsFolder(t))).toEqual([
      'Second Brain Kho thứ hai 2026-10-22 1200.zip',
      'Second Brain vault 2026-10-22 1200.zip',
    ]);
  });

  it('a folder inside the vault is refused: it would back itself up', async () => {
    const { clock, t } = await setup(at(2026, 10, 22, 20, 0));
    t.settings.backup.schedule.folder = path.join(t.vaultRoot, '3 Resources', 'Sao lưu');
    const s = await startSchedule(t, { now: clock.now });
    expect((await s.service.status()).folderProblem).toBe('inside-vault');
    clock.set(at(2026, 10, 22, 21, 0));
    await tick(s);
    expect((await s.service.status()).lastRun).toMatchObject({ ok: false, error: 'inside-vault' });
    t.settings.backup.schedule.folder = path.join(t.home, '.secondbrain', 'zips');
    expect((await s.service.status()).folderProblem).toBe('inside-app');
  });
});
