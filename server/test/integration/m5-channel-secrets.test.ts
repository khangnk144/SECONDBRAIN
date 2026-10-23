import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackupSchedulePlugin } from '../../src/backup/schedule/backup-schedule-plugin.js';
import { createRemindersPlugin } from '../../src/reminders/reminders-plugin.js';
import { REMINDERS_PLUGIN } from '../../src/app-context/vault-plugins.js';
import type { ReminderService } from '../../src/reminders/reminder-types.js';
import { makeClock } from '../index/helpers/index-test-vault.js';
import {
  createMemoryLogger,
  createVaultTestApp,
  type VaultTestApp,
} from '../api/vault-test-app.js';
import {
  at,
  manualTimers,
  projectNote,
  recordingDeliverer,
} from '../reminders/helpers/reminder-test-host.js';

const TOKEN = 'ghp_GITHUBSECRET00000000000000000000aaaa';
const BOT = '7012345678:AAH-TELEGRAMSECRET1111111111111111bbbb';
const PASSWORD = 'smtp mật khẩu cccc';
const SECRETS = [TOKEN, BOT, PASSWORD];

let t: VaultTestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('channel secrets never leave settings.json (F31.3, F27.5)', () => {
  it('(F31.3) not in responses, logs, the outbox, backups.json or a scheduled backup zip', async () => {
    const clock = makeClock(at(2026, 10, 21, 8, 0));
    const logger = createMemoryLogger();
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ description: `nope ${BOT}` }), { status: 401 }),
    );
    t = await createVaultTestApp(47866, {
      now: clock.now,
      watcher: false,
      logger,
      vaultRoutes: { notify: { fetch } },
      plugins: [
        createRemindersPlugin({
          timers: manualTimers(),
          deliver: recordingDeliverer(),
          notify: { fetch, createTransport: () => Promise.reject(new Error(PASSWORD)) },
        }),
        createBackupSchedulePlugin({ timers: manualTimers(), now: clock.now }),
      ],
    });
    Object.assign(t.settings.backup.github, {
      enabled: true,
      remoteUrl: 'https://github.com/khangnie/kho.git',
      token: TOKEN,
    });
    Object.assign(t.settings.notify.telegram, { enabled: true, chatId: '1', botToken: BOT });
    Object.assign(t.settings.notify.email, {
      enabled: true,
      host: 'smtp.gmail.com',
      user: 'khangnie',
      password: PASSWORD,
      from: 'a@truong.edu.vn',
      to: 'b@gmail.com',
    });
    await t.context.vault.create('1 Projects/Đồ án Giải tích.md', projectNote('2026-10-24'));
    await t.context.settled();
    // A reminder fires: both channels fail (the outbox now holds entries with errors).
    await t.context.plugin<ReminderService>(REMINDERS_PLUGIN)?.runNow();
    expect(fetch).toHaveBeenCalled();

    const bodies = [
      (await t.call('GET', '/api/settings')).body,
      (await t.call('GET', '/api/notify/status')).body,
      (await t.call('POST', '/api/notify/test', { channel: 'telegram' })).body,
      (await t.call('POST', '/api/notify/test', { channel: 'email' })).body,
      (await t.call('POST', '/api/backup/github/push')).body,
      (await t.call('GET', '/api/backup/schedule')).body,
    ];
    const run = await t.call('POST', '/api/backup/schedule/run');
    expect(run.json().ok).toBe(true);
    bodies.push(run.body);

    const zipFile = path.join(t.home, 'Backups', run.json().run.fileName);
    const entries = unzipSync(new Uint8Array(readFileSync(zipFile)));
    expect(Object.keys(entries)).toContain('.secondbrain/state/notify-outbox.json');
    const files = [
      ...Object.values(entries).map((bytes) => Buffer.from(bytes).toString('utf8')),
      readFileSync(path.join(t.vaultRoot, '.secondbrain', 'state', 'notify-outbox.json'), 'utf8'),
      readFileSync(path.join(t.home, '.secondbrain', 'backups.json'), 'utf8'),
    ];
    for (const text of [...bodies, ...files, logger.lines.join('\n')])
      for (const secret of SECRETS) expect(text.includes(secret)).toBe(false);
  });
});
