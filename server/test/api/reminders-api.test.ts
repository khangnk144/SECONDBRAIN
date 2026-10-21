import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReminderEntry } from '../../src/reminders/reminder-types.js';
import { makeClock } from '../index/helpers/index-test-vault.js';
import {
  at,
  createNote,
  projectNote,
  recordingDeliverer,
  rewriteNote,
  startReminders,
  storeFile,
} from '../reminders/helpers/reminder-test-host.js';
import { createVaultTestApp, type VaultTestApp } from './vault-test-app.js';

const A = '1 Projects/Đồ án Giải tích.md';
const B = '2 Areas/Môn Xác suất.md';
const C = '0 Inbox/Việc lặt vặt.md';
let t: VaultTestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup(start: Date) {
  const clock = makeClock(start);
  t = await createVaultTestApp(47623, { now: clock.now, watcher: false });
  return { clock, t };
}

type ListBody = {
  available: boolean;
  time: string;
  toastSupported: boolean;
  reminders: ReminderEntry[];
};

describe('GET /api/reminders and POST /api/reminders/dismiss (F17, §9)', () => {
  it('without the plugin: an empty list marked unavailable, and dismiss answers 503', async () => {
    const { t } = await setup(at(2026, 10, 21, 8));
    const res = await t.call('GET', '/api/reminders');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      available: false,
      time: '08:00',
      toastSupported: false,
      reminders: [],
    });
    const dismiss = await t.call('POST', '/api/reminders/dismiss', { keys: ['x'] });
    expect(dismiss.statusCode).toBe(503);
    expect(dismiss.json().error.code).toBe('UNAVAILABLE');
  });

  it('lists open, undismissed reminders of the last 7 days, newest first', async () => {
    const { clock, t } = await setup(at(2026, 10, 21, 8));
    await createNote(t, A, projectNote('2026-10-24'));
    await createNote(t, B, projectNote('2026-10-30'));
    await createNote(t, C, '# Việc\n\n- [ ] Đóng học phí 📅 2026-10-24\n');
    const r = await startReminders(t, { deliverer: recordingDeliverer(false) });
    await r.service.runNow();
    clock.set(at(2026, 10, 27, 8));
    await r.service.runNow();

    const list = async () => (await t.call('GET', '/api/reminders')).json() as ListBody;
    let body = await list();
    expect(body).toMatchObject({ available: true, time: '08:00', toastSupported: false });
    expect(body.reminders.map((e) => [e.path, e.threshold, e.toast])).toEqual([
      [B, 3, 'unsupported'],
      [A, 3, 'unsupported'],
      [C, 3, 'unsupported'],
    ]);
    // The 7-day window: on 29/10 the reminders of 21/10 are gone.
    clock.set(at(2026, 10, 29, 7));
    body = await list();
    expect(body.reminders.map((e) => e.path)).toEqual([B]);
    clock.set(at(2026, 10, 27, 9));

    // Ticking the task drops its reminder; a reschedule drops the one for the old date.
    await rewriteNote(t, C, (c) => c.replace('- [ ]', '- [x]'));
    await rewriteNote(t, A, (c) => c.replace('2026-10-24', '2026-11-20'));
    expect((await list()).reminders.map((e) => e.path)).toEqual([B]);
    t.settings.reminders = { time: '19:30' };
    expect((await list()).time).toBe('19:30');
  });

  it('dismiss hides entries, ignores unknown keys, counts only what it changed, writes atomically', async () => {
    const { t } = await setup(at(2026, 10, 21, 8));
    await createNote(t, A, projectNote('2026-10-24'));
    await createNote(t, B, projectNote('2026-10-24'));
    const r = await startReminders(t);
    await r.service.runNow();
    const before = (await t.call('GET', '/api/reminders')).json() as ListBody;
    expect(before.toastSupported).toBe(true);
    const keyA = before.reminders.find((e) => e.path === A)!.key;

    const res = await t.call('POST', '/api/reminders/dismiss', { keys: [keyA, 'unknown|key'] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ dismissed: 1 });
    const after = (await t.call('GET', '/api/reminders')).json() as ListBody;
    expect(after.reminders.map((e) => e.path)).toEqual([B]);
    const disk = JSON.parse(readFileSync(storeFile(t), 'utf8'));
    expect(disk.entries.find((e: ReminderEntry) => e.key === keyA).dismissed).toBe(true);
    expect((await t.call('POST', '/api/reminders/dismiss', { keys: [keyA] })).json()).toEqual({
      dismissed: 0,
    });
    // A dismissed reminder is still remembered: it never fires again.
    expect(await r.service.runNow()).toEqual([]);
  });

  it('GET changes nothing on disk', async () => {
    const { t } = await setup(at(2026, 10, 21, 8));
    await createNote(t, A, projectNote('2026-10-24'));
    const r = await startReminders(t);
    await r.service.runNow();
    const bytes = readFileSync(storeFile(t), 'utf8');
    for (let i = 0; i < 3; i += 1) await t.call('GET', '/api/reminders');
    expect(readFileSync(storeFile(t), 'utf8')).toBe(bytes);
  });

  it.each([
    ['no keys', {}],
    ['an empty list', { keys: [] }],
    ['more than 500 keys', { keys: Array.from({ length: 501 }, (_, i) => `k${i}`) }],
    ['a key that is too long', { keys: ['k'.repeat(8193)] }],
    ['an empty key', { keys: [''] }],
  ])('dismiss refuses %s with 400 VALIDATION', async (_name, payload) => {
    const { t } = await setup(at(2026, 10, 21, 8));
    await startReminders(t);
    const res = await t.call('POST', '/api/reminders/dismiss', payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });
});
