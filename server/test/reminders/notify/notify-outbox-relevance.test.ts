// Telegram/email retries follow the item (F31.2 with F17), and slow sends never hold up the
// scheduler or a shutdown (review A, M2 and L10).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutboxEntry } from '../../../src/reminders/notify-outbox.js';
import type { NotifyStatusSource } from '../../../src/reminders/notify-outbox-service.js';
import { outboxItemId } from '../../../src/reminders/notify-outbox-relevance.js';
import { makeClock } from '../../index/helpers/index-test-vault.js';
import { createVaultTestApp, type VaultTestApp } from '../../api/vault-test-app.js';
import {
  at,
  createNote,
  projectNote,
  rewriteNote,
  startReminders,
} from '../helpers/reminder-test-host.js';

const P = '1 Projects/Đồ án Giải tích.md';
const BOT = '7012345678:AAH-TELEGRAMSECRET1111111111111111bbbb';

let t: VaultTestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup(start: Date) {
  const clock = makeClock(start);
  t = await createVaultTestApp(47866, { now: clock.now, watcher: false });
  await createNote(t, P, projectNote('2026-10-24'));
  Object.assign(t.settings.notify.telegram, { enabled: true, chatId: '123456789', botToken: BOT });
  return { clock, t };
}

const readOutbox = (t: VaultTestApp): OutboxEntry[] =>
  JSON.parse(readFileSync(path.join(t.context.vault.paths.stateDir, 'notify-outbox.json'), 'utf8'))
    .entries;

/** Fails while `down` is true; records the text of every message that went out. */
function flakyTelegram() {
  const state = { down: true, sent: [] as string[] };
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (state.down) return new Response('{}', { status: 502 });
    state.sent.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return new Response('{"ok":true}', { status: 200 });
  });
  return { state, fetch };
}

describe('retries only remind about what is still open with that date (F31.2, F17)', () => {
  it.each([
    ['marked done', (c: string) => c.replace('status: doing', 'status: done')],
    ['rescheduled', (c: string) => c.replace('deadline: 2026-10-24', 'deadline: 2026-10-30')],
  ])(
    '(F31.2) a project %s after a failed send is never sent with the old date',
    async (_, edit) => {
      const { clock, t } = await setup(at(2026, 10, 21, 8, 0));
      const telegram = flakyTelegram();
      const r = await startReminders(t, { notify: { fetch: telegram.fetch } });
      await r.service.runNow(); // 08:00: Telegram unreachable
      expect(telegram.fetch).toHaveBeenCalledTimes(1);
      await rewriteNote(t, P, edit);
      telegram.state.down = false;
      clock.set(at(2026, 10, 21, 8, 1));
      await r.service.runNow();
      expect(telegram.state.sent).toEqual([]);
      expect(readOutbox(t)[0]).toMatchObject({ status: 'dropped', lastError: 'not-relevant' });
      // Settings shows no channel failure for it.
      const status = (r.service as typeof r.service & NotifyStatusSource).notifyStatus?.();
      expect(status?.telegram).toEqual({ pending: 0, lastSentAt: null, lastError: null });
      clock.set(at(2026, 10, 21, 10, 0));
      await r.service.runNow();
      expect(telegram.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('(F31.2) a deleted note is never sent; a still-open one is sent on the retry', async () => {
    const { clock, t } = await setup(at(2026, 10, 21, 8, 0));
    const other = '1 Projects/Báo cáo Vật lý.md';
    await createNote(t, other, projectNote('2026-10-24'));
    const telegram = flakyTelegram();
    const r = await startReminders(t, { notify: { fetch: telegram.fetch } });
    await r.service.runNow();
    const current = await t.context.vault.read(P);
    await t.context.vault.trash([P], [current.revision], 'user');
    await t.context.settled();
    telegram.state.down = false;
    clock.set(at(2026, 10, 21, 8, 1));
    await r.service.runNow();
    expect(telegram.state.sent).toHaveLength(1);
    expect(telegram.state.sent[0]).toContain('Báo cáo Vật lý');
    const byPath = new Map(readOutbox(t).map((e) => [e.path, e]));
    expect(byPath.get(P)).toMatchObject({ status: 'dropped', lastError: 'not-relevant' });
    expect(byPath.get(other)).toMatchObject({ status: 'sent' });
  });

  it('(F31.2) a task ticked off after a failed send is never sent', async () => {
    const { clock, t } = await setup(at(2026, 10, 21, 8, 0));
    const tasks = '2 Areas/Giải tích 1.md';
    await createNote(t, tasks, '# Giải tích 1\n\n- [ ] Nộp bài tập 📅 2026-10-22\n');
    const telegram = flakyTelegram();
    const r = await startReminders(t, { notify: { fetch: telegram.fetch } });
    await r.service.runNow();
    expect(
      readOutbox(t)
        .map((e) => e.title)
        .sort(),
    ).toEqual(['Nộp bài tập', 'Đồ án Giải tích']);
    await rewriteNote(t, tasks, (c) => c.replace('- [ ] Nộp', '- [x] Nộp'));
    telegram.state.down = false;
    clock.set(at(2026, 10, 21, 8, 1));
    await r.service.runNow();
    expect(telegram.state.sent.map((text) => text.split('\n')[0])).toEqual([
      '⏰ Đồ án Giải tích – hạn 24/10/2026 (còn 3 ngày)',
    ]);
    const task = readOutbox(t).find((e) => e.title === 'Nộp bài tập');
    expect(task).toMatchObject({ status: 'dropped', lastError: 'not-relevant' });
  });

  it('the item id is read back from the reminder key, paths with "|" included', () => {
    const entry = { due: '2026-10-24', threshold: 3 as const };
    expect(outboxItemId({ ...entry, reminderKey: `v1|note:${P}|2026-10-24|3` })).toBe(`note:${P}`);
    expect(outboxItemId({ ...entry, reminderKey: 'v1|task:a|b.md#4|2026-10-24|3' })).toBe(
      'task:a|b.md#4',
    );
    expect(outboxItemId({ ...entry, reminderKey: 'v1|note:x.md|2026-10-25|3' })).toBeNull();
    expect(outboxItemId({ ...entry, reminderKey: 'garbled' })).toBeNull();
  });
});

describe('slow sends never hold up reminders or a shutdown (F31.2, F17)', () => {
  /** A Telegram that never answers until released (or aborted). */
  function hangingTelegram() {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetch = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          void gate.then(() => resolve(new Response('{"ok":true}', { status: 200 })));
        }),
    );
    return { fetch, release: () => release() };
  }

  const until = async (check: () => boolean, ms = 2_000) => {
    const end = Date.now() + ms;
    while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
    return check();
  };

  it('(F17) the next check and its toast run while a send is still waiting for the server', async () => {
    const { t } = await setup(at(2026, 10, 21, 8, 0));
    const telegram = hangingTelegram();
    const r = await startReminders(t, {
      notify: { fetch: telegram.fetch, telegramTimeoutMs: 60_000 },
    });
    const first = r.service.runNow();
    expect(await until(() => telegram.fetch.mock.calls.length === 1)).toBe(true);
    await createNote(t, '1 Projects/Báo cáo Vật lý.md', projectNote('2026-10-22'));
    r.timers.tick(); // the 60 s beat, while the first message is still on its way
    expect(await until(() => r.deliverer.toasts.length === 2)).toBe(true);
    telegram.release();
    await first;
    expect(await until(() => telegram.fetch.mock.calls.length === 2)).toBe(true);
    await r.service.runNow();
    expect(readOutbox(t).every((e) => e.status === 'sent')).toBe(true);
  });

  it('closing aborts a send in flight at once; it counts as interrupted and is not repeated', async () => {
    const { t } = await setup(at(2026, 10, 21, 8, 0));
    const telegram = hangingTelegram();
    const r = await startReminders(t, {
      notify: { fetch: telegram.fetch, telegramTimeoutMs: 60_000 },
    });
    void r.service.runNow();
    expect(await until(() => telegram.fetch.mock.calls.length === 1)).toBe(true);
    const started = Date.now();
    await r.service.close();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(readOutbox(t)[0]).toMatchObject({ status: 'failed', lastError: 'interrupted' });
  });
});
