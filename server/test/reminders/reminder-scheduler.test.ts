import { afterEach, describe, expect, it } from 'vitest';
import { makeClock } from '../index/helpers/index-test-vault.js';
import { createVaultTestApp, type VaultTestApp } from '../api/vault-test-app.js';
import {
  at,
  captureEvents,
  createNote,
  projectNote,
  readStore,
  rewriteNote,
  startReminders,
} from './helpers/reminder-test-host.js';

const P = '1 Projects/Đồ án Giải tích.md';
let t: VaultTestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup(start: Date) {
  const clock = makeClock(start);
  t = await createVaultTestApp(47620, { now: clock.now, watcher: false });
  return { clock, t };
}

describe('reminders fire at the configured time, once per key (F17.1)', () => {
  it('07:59 nothing, 08:00 the 3-day one, two days later the 1-day one, then the due day', async () => {
    const { clock, t } = await setup(at(2026, 10, 21, 7, 0));
    await createNote(t, P, projectNote('2026-10-24'));
    const events = captureEvents(t);
    const r = await startReminders(t);
    const step = async (when: Date) => {
      clock.set(when);
      r.timers.tick();
      return r.service.runNow();
    };

    await step(at(2026, 10, 21, 7, 59));
    expect(r.deliverer.toasts).toEqual([]);
    await step(at(2026, 10, 21, 8, 0));
    await step(at(2026, 10, 21, 8, 1));
    await step(at(2026, 10, 22, 8, 0));
    await step(at(2026, 10, 23, 7, 59));
    expect(r.deliverer.toasts.map((x) => x.title)).toEqual(['Còn 3 ngày: Đồ án Giải tích']);
    await step(at(2026, 10, 23, 8, 0));
    await step(at(2026, 10, 24, 8, 0));
    await step(at(2026, 10, 24, 9, 0));
    expect(r.deliverer.toasts).toEqual([
      expect.objectContaining({ title: 'Còn 3 ngày: Đồ án Giải tích' }),
      expect.objectContaining({ title: 'Còn 1 ngày: Đồ án Giải tích' }),
      {
        title: 'Hôm nay đến hạn: Đồ án Giải tích',
        body: 'Hạn chót 24/10/2026. Bấm để mở ghi chú.',
        link: `http://localhost:${t.port}/#/note?path=${encodeURIComponent(P)}`,
      },
    ]);

    const id = t.context.vault.id;
    const store = readStore(t);
    expect(store.entries.map((e) => [e.key, e.threshold, e.missed, e.toast])).toEqual([
      [`${id}|note:${P}|2026-10-24|3`, 3, false, 'shown'],
      [`${id}|note:${P}|2026-10-24|1`, 1, false, 'shown'],
      [`${id}|note:${P}|2026-10-24|0`, 0, false, 'shown'],
    ]);
    expect(store.entries[0]).toMatchObject({
      itemId: `note:${P}`,
      path: P,
      title: 'Đồ án Giải tích',
      due: '2026-10-24',
      firedAt: at(2026, 10, 21, 8).toISOString(),
      dismissed: false,
    });
    // Each recorded entry is announced to open windows with its final toast outcome.
    const announced = events.filter((e) => e.type === 'reminder');
    expect(announced).toEqual(store.entries.map((reminder) => ({ type: 'reminder', reminder })));
  });

  it('a new reminder time applies at the next check, without a restart', async () => {
    const { clock, t } = await setup(at(2026, 10, 21, 7, 30));
    await createNote(t, P, projectNote('2026-10-24'));
    t.settings.reminders = { time: '08:00' };
    const r = await startReminders(t);
    expect(await r.service.runNow()).toEqual([]);
    expect(r.service.time()).toBe('08:00');
    t.settings.reminders = { time: '07:30' };
    expect(r.service.time()).toBe('07:30');
    const fired = await r.service.runNow();
    expect(fired.map((e) => [e.threshold, e.missed])).toEqual([[3, false]]);
    t.settings.reminders = { time: '21:15' };
    clock.set(at(2026, 10, 23, 21, 14));
    expect(await r.service.runNow()).toEqual([]);
    clock.set(at(2026, 10, 23, 21, 15));
    expect((await r.service.runNow()).map((e) => e.threshold)).toEqual([1]);
  });

  it('a reschedule (📅 date or deadline:) fires again for the new date', async () => {
    const { clock, t } = await setup(at(2026, 10, 21, 8, 0));
    await createNote(t, P, `${projectNote('2026-10-24')}\n- [ ] Nộp báo cáo 📅 2026-10-24\n`);
    const r = await startReminders(t);
    await r.service.runNow();
    expect(r.deliverer.toasts.map((x) => x.title).sort()).toEqual([
      'Còn 3 ngày: Nộp báo cáo',
      'Còn 3 ngày: Đồ án Giải tích',
    ]);
    await rewriteNote(t, P, (c) => c.replaceAll('2026-10-24', '2026-10-28'));
    expect(await r.service.runNow()).toEqual([]);
    clock.set(at(2026, 10, 25, 8, 0));
    const again = await r.service.runNow();
    expect(again.map((e) => [e.title, e.due, e.threshold]).sort()).toEqual([
      ['Nộp báo cáo', '2026-10-28', 3],
      ['Đồ án Giải tích', '2026-10-28', 3],
    ]);
    expect(new Set(readStore(t).entries.map((e) => e.key)).size).toBe(4);
  });

  it('ticking the task, status: done or deleting the note stops every later reminder', async () => {
    const { clock, t } = await setup(at(2026, 10, 21, 8, 0));
    const A = '1 Projects/Đồ án A.md';
    const B = '2 Areas/Việc nhà.md';
    const C = '0 Inbox/Ghi chú hạn.md';
    await createNote(t, A, projectNote('2026-10-24'));
    await createNote(t, B, '# Việc\n\n- [ ] Đóng tiền điện 📅 2026-10-24\n');
    await createNote(t, C, projectNote('2026-10-24'));
    const r = await startReminders(t);
    await r.service.runNow(); // the start-up pass fires them
    expect(r.deliverer.toasts).toHaveLength(3);

    await rewriteNote(t, A, (c) => c.replace('status: doing', 'status: done'));
    await rewriteNote(t, B, (c) => c.replace('- [ ]', '- [x]'));
    const c = await t.context.vault.read(C);
    await t.context.vault.trash([C], [c.revision]);
    await t.context.settled();
    for (const when of [at(2026, 10, 23, 8), at(2026, 10, 24, 8), at(2026, 10, 25, 9)]) {
      clock.set(when);
      expect(await r.service.runNow()).toEqual([]);
    }
    expect(r.deliverer.toasts).toHaveLength(3);
  });

  it('a task whose line moved is not reminded twice', async () => {
    const { t } = await setup(at(2026, 10, 23, 8, 0));
    await createNote(t, P, '# Đồ án\n\n- [ ] Nộp báo cáo 📅 2026-10-24\n');
    const r = await startReminders(t);
    await r.service.runNow();
    expect(readStore(t).entries.map((e) => e.itemId)).toEqual([`task:${P}#3`]);
    await rewriteNote(t, P, (c) => c.replace('# Đồ án\n', '# Đồ án\n\nThêm một dòng.\n'));
    expect(t.context.deadlines.items().map((i) => i.id)).toEqual([`task:${P}#5`]);
    expect(await r.service.runNow()).toEqual([]);
    expect(r.deliverer.toasts).toHaveLength(1);
    expect(r.service.list().map((e) => e.itemId)).toEqual([`task:${P}#3`]);
  });
});
