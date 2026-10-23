import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RevealCommand } from '../../src/api/reveal-command.js';
import { createBackupSchedulePlugin } from '../../src/backup/schedule/backup-schedule-plugin.js';
import { manualTimers } from '../reminders/helpers/reminder-test-host.js';
import { makeClock } from '../index/helpers/index-test-vault.js';
import { createVaultTestApp, type VaultTestApp } from './vault-test-app.js';

let t: VaultTestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup(options: { plugin?: boolean } = {}) {
  const clock = makeClock(new Date(2026, 9, 22, 12, 0));
  const reveals: RevealCommand[] = [];
  t = await createVaultTestApp(47863, {
    now: clock.now,
    watcher: false,
    plugins:
      options.plugin === false
        ? []
        : [createBackupSchedulePlugin({ now: clock.now, timers: manualTimers() })],
    vaultRoutes: { reveal: { spawn: (command) => reveals.push(command), platform: 'linux' } },
  });
  return { t, reveals };
}

describe('/api/backup/schedule routes (F27.4)', () => {
  it('(F27.4) status, "Sao lưu ngay" and "Mở thư mục" on the configured folder only', async () => {
    const { t, reveals } = await setup();
    const status = await t.call('GET', '/api/backup/schedule');
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      available: true,
      enabled: false,
      time: '21:00',
      keep: 14,
      folder: path.join(t.home, 'Backups'),
      isDefaultFolder: true,
      folderProblem: null,
      nextRunAt: null,
      lastRun: null,
      github: { enabled: false, configured: false, pushing: false, lastPush: null },
    });
    // GET never creates anything: the default folder appears with the first backup.
    expect(existsSync(path.join(t.home, 'Backups'))).toBe(false);

    const run = await t.call('POST', '/api/backup/schedule/run');
    expect(run.statusCode).toBe(200);
    expect(run.json()).toMatchObject({
      ok: true,
      run: { kind: 'manual', ok: true, fileName: 'Second Brain vault 2026-10-22 1200.zip' },
    });
    const after = (await t.call('GET', '/api/backup/schedule')).json();
    expect(after.lastSuccess.fileName).toBe('Second Brain vault 2026-10-22 1200.zip');
    expect(after.runs).toHaveLength(1);
    expect(after.runs[0]).not.toHaveProperty('file'); // file names only, no absolute paths

    const open = await t.call('POST', '/api/backup/schedule/open-folder');
    expect(open.statusCode).toBe(204);
    // Linux reveal = xdg-open on the parent of the selected zip, i.e. the backup folder.
    expect(reveals).toEqual([{ command: 'xdg-open', args: [path.join(t.home, 'Backups')] }]);
  });

  it('a folder inside the vault is refused with VALIDATION; a missing one cannot be opened', async () => {
    const { t, reveals } = await setup();
    t.settings.backup.schedule.folder = path.join(t.vaultRoot, 'Sao lưu');
    const refused = await t.call('POST', '/api/backup/schedule/run');
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toMatchObject({
      code: 'VALIDATION',
      details: { field: 'backup.schedule.folder', reason: 'inside-vault' },
    });
    expect(existsSync(path.join(t.vaultRoot, 'Sao lưu'))).toBe(false);

    t.settings.backup.schedule.folder = path.join(t.home, 'Ổ USB', 'Sao lưu');
    const missing = await t.call('POST', '/api/backup/schedule/open-folder');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.details).toEqual({ reason: 'folder-missing' });
    const failed = await t.call('POST', '/api/backup/schedule/run');
    expect(failed.json()).toMatchObject({ ok: false, error: 'folder-missing' });
    expect(existsSync(path.join(t.home, 'Ổ USB'))).toBe(false); // a chosen folder is never created
    mkdirSync(path.join(t.home, 'Ổ USB', 'Sao lưu'), { recursive: true });
    expect((await t.call('POST', '/api/backup/schedule/open-folder')).statusCode).toBe(204);
    expect(reveals).toHaveLength(1);
  });

  it('"Đẩy ngay" without a remote says not-configured; without the plugin 503 / available false', async () => {
    const { t } = await setup();
    const push = await t.call('POST', '/api/backup/github/push');
    expect(push.statusCode).toBe(200);
    expect(push.json()).toMatchObject({ ok: false, error: 'not-configured' });
    await t.close();

    const bare = await setup({ plugin: false });
    expect((await bare.t.call('GET', '/api/backup/schedule')).json()).toEqual({ available: false });
    expect((await bare.t.call('POST', '/api/backup/schedule/run')).statusCode).toBe(503);
  });
});
