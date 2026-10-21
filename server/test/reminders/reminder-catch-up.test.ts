import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { REMINDERS_PLUGIN } from '../../src/app-context/vault-plugins.js';
import type { AtomicWriteHooks } from '../../src/fs/atomic-write-file.js';
import type { ReminderService, ToastOutcome } from '../../src/reminders/reminder-types.js';
import { makeClock } from '../index/helpers/index-test-vault.js';
import { createVaultTestApp, type VaultTestApp } from '../api/vault-test-app.js';
import {
  at,
  createNote,
  projectNote,
  readStore,
  recordingDeliverer,
  startReminders,
  storeFile,
} from './helpers/reminder-test-host.js';

const P = '1 Projects/Đồ án Giải tích.md';
let t: VaultTestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup(start: Date) {
  const clock = makeClock(start);
  t = await createVaultTestApp(47621, { now: clock.now, watcher: false });
  return { clock, t };
}

describe('missed reminders are caught up once after sleep or a restart (F17.2)', () => {
  it('sleeping over 08:00 gives exactly one catch-up on wake, marked missed', async () => {
    const { clock, t } = await setup(at(2026, 10, 21, 7, 58));
    await createNote(t, P, projectNote('2026-10-24'));
    const r = await startReminders(t);
    clock.set(at(2026, 10, 21, 7, 59));
    r.timers.tick();
    await r.service.runNow();
    expect(r.deliverer.toasts).toEqual([]);

    clock.set(at(2026, 10, 21, 11, 30)); // the laptop slept from 07:59 to 11:30
    r.timers.tick();
    const caughtUp = await r.service.runNow();
    expect(r.logger.lines.some((l) => l.includes('woke up'))).toBe(true);
    for (const minute of [31, 32, 33]) {
      clock.set(at(2026, 10, 21, 11, minute));
      r.timers.tick();
      await r.service.runNow();
    }
    expect(caughtUp).toEqual([]); // the tick's own pass fired it, before runNow
    expect(r.deliverer.toasts.map((x) => x.title)).toEqual(['Còn 3 ngày: Đồ án Giải tích']);
    expect(readStore(t).entries.map((e) => [e.threshold, e.missed])).toEqual([[3, true]]);
  });

  it('a restart repeats nothing: a new plugin instance on the same vault stays quiet', async () => {
    const { clock, t } = await setup(at(2026, 10, 21, 8, 0));
    await createNote(t, P, projectNote('2026-10-24'));
    const first = await startReminders(t);
    await first.service.runNow();
    expect(first.deliverer.toasts).toHaveLength(1);
    await first.service.close();
    expect(first.timers.active).toBe(0);

    clock.set(at(2026, 10, 21, 9, 0));
    const second = await startReminders(t);
    expect(await second.service.runNow()).toEqual([]);
    expect(second.deliverer.toasts).toEqual([]);
    expect(readStore(t).entries).toHaveLength(1);
  });

  it('the store is written before the toast: a crash during delivery loses it, never repeats it', async () => {
    const { t } = await setup(at(2026, 10, 21, 8, 0));
    await createNote(t, P, projectNote('2026-10-24'));
    let release: (outcome: ToastOutcome) => void = () => undefined;
    const hanging = recordingDeliverer();
    hanging.deliver = (toast) => {
      hanging.toasts.push(toast);
      return new Promise((resolve) => (release = resolve));
    };
    const crashed = await startReminders(t, { deliverer: hanging });
    await expect.poll(() => hanging.toasts.length).toBe(1);
    // While the toast is still being shown the reminder is already on disk (outcome not known yet).
    expect(readStore(t).entries.map((e) => [e.threshold, e.toast])).toEqual([[3, 'failed']]);

    // "Crash": the old instance is abandoned; the next start reads the store.
    const restarted = await startReminders(t);
    expect(await restarted.service.runNow()).toEqual([]);
    expect(restarted.deliverer.toasts).toEqual([]);
    release('shown');
    await crashed.service.close();
    expect(readStore(t).entries.map((e) => e.toast)).toEqual(['shown']);
  });

  it('the 3-day reminder missed while the 1-day one is due: only the 1-day toast', async () => {
    const { clock, t } = await setup(at(2026, 10, 20, 7, 0));
    await createNote(t, P, projectNote('2026-10-24'));
    const before = await startReminders(t);
    await before.service.close(); // the machine is off from 20/10 07:00 until 23/10 09:00
    clock.set(at(2026, 10, 23, 9, 0));
    const r = await startReminders(t);
    const fired = await r.service.runNow();
    expect(r.deliverer.toasts.map((x) => x.title)).toEqual(['Còn 1 ngày: Đồ án Giải tích']);
    expect(readStore(t).entries.map((e) => [e.threshold, e.missed])).toEqual([[1, true]]);
    expect(fired).toEqual([]); // the start-up pass fired it already
    const id = t.context.vault.id;
    expect(readStore(t).superseded.map((s) => s.key)).toEqual([`${id}|note:${P}|2026-10-24|3`]);
    clock.set(at(2026, 10, 24, 8, 0));
    await r.service.runNow();
    expect(r.deliverer.toasts.map((x) => x.title)).toEqual([
      'Còn 1 ngày: Đồ án Giải tích',
      'Hôm nay đến hạn: Đồ án Giải tích',
    ]);
  });

  it('a due-day reminder caught up after midnight says overdue; older ones get no toast', async () => {
    const { t } = await setup(at(2026, 10, 25, 9, 0));
    await createNote(t, P, projectNote('2026-10-24'));
    await createNote(t, '1 Projects/Đồ án cũ.md', projectNote('2026-10-22'));
    const r = await startReminders(t);
    await r.service.runNow();
    expect(r.deliverer.toasts.map((x) => x.title)).toEqual(['Đã quá hạn: Đồ án Giải tích']);
  });

  it('a failed store write shows no toast; the next check fires it once', async () => {
    const { t } = await setup(at(2026, 10, 21, 8, 0));
    await createNote(t, P, projectNote('2026-10-24'));
    const hooks: AtomicWriteHooks = {
      beforeWrite: () => {
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      },
    };
    const r = await startReminders(t, { storeHooks: hooks });
    expect(await r.service.runNow()).toEqual([]);
    expect(r.deliverer.toasts).toEqual([]);
    expect(() => readFileSync(storeFile(t))).toThrow();
    expect(r.logger.lines.join('\n')).toContain('Reminder check failed (ENOSPC)');
    hooks.beforeWrite = undefined;
    expect(await r.service.runNow()).toHaveLength(1);
    expect(await r.service.runNow()).toEqual([]);
    expect(r.deliverer.toasts).toHaveLength(1);
  });
});

describe('a burst of reminders becomes one summary toast', () => {
  it('five due at once → one toast to Today, five recorded entries; English follows the UI', async () => {
    const { clock, t } = await setup(at(2026, 10, 21, 8, 0));
    for (let i = 1; i <= 5; i += 1)
      await createNote(t, `1 Projects/Đồ án ${i}.md`, projectNote('2026-10-24'));
    for (let i = 1; i <= 4; i += 1)
      await createNote(t, `2 Areas/Môn ${i}.md`, projectNote('2026-10-26'));
    const r = await startReminders(t);
    await r.service.runNow();
    expect(r.deliverer.toasts).toEqual([
      {
        title: 'Bạn có 5 deadline sắp tới',
        body: 'Bấm để xem trang Hôm nay.',
        link: `http://localhost:${t.port}/#/`,
      },
    ]);
    const entries = readStore(t).entries;
    expect(entries).toHaveLength(5);
    expect(entries.every((e) => e.toast === 'shown' && e.threshold === 3)).toBe(true);

    t.settings.ui.language = 'en';
    clock.set(at(2026, 10, 23, 8, 0)); // 1-day for five, 3-day for four: nine at once
    await r.service.runNow();
    expect(r.deliverer.toasts.at(-1)?.title).toBe('You have 9 upcoming deadlines');
    expect(readStore(t).entries).toHaveLength(14);
  });

  it('three at once are three separate toasts', async () => {
    const { t } = await setup(at(2026, 10, 21, 8, 0));
    for (let i = 1; i <= 3; i += 1)
      await createNote(t, `1 Projects/Đồ án ${i}.md`, projectNote('2026-10-24'));
    const r = await startReminders(t);
    await r.service.runNow();
    expect(r.deliverer.toasts.map((x) => x.title).sort()).toEqual([
      'Còn 3 ngày: Đồ án 1',
      'Còn 3 ngày: Đồ án 2',
      'Còn 3 ngày: Đồ án 3',
    ]);
    const attached = t.context.plugin<ReminderService>(REMINDERS_PLUGIN);
    expect(attached?.list()).toHaveLength(3);
  });
});
