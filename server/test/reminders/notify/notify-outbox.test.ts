import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutboxEntry } from '../../../src/reminders/notify-outbox.js';
import type { NotifyStatusSource } from '../../../src/reminders/notify-outbox-service.js';
import { BACKOFF_MS, retryDelay } from '../../../src/reminders/notify-outbox-worker.js';
import { makeClock } from '../../index/helpers/index-test-vault.js';
import { createVaultTestApp, type VaultTestApp } from '../../api/vault-test-app.js';
import { at, createNote, projectNote, startReminders } from '../helpers/reminder-test-host.js';

const P = '1 Projects/Đồ án Giải tích.md';
const BOT = '7012345678:AAH-TELEGRAMSECRET1111111111111111bbbb';

let t: VaultTestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup(start: Date) {
  const clock = makeClock(start);
  t = await createVaultTestApp(47864, { now: clock.now, watcher: false });
  await createNote(t, P, projectNote('2026-10-24'));
  return { clock, t };
}

function telegramOn(t: VaultTestApp) {
  Object.assign(t.settings.notify.telegram, { enabled: true, chatId: '123456789', botToken: BOT });
}

const okFetch = () => vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
const outboxFile = (t: VaultTestApp) =>
  path.join(t.context.vault.paths.stateDir, 'notify-outbox.json');
const readOutbox = (t: VaultTestApp): OutboxEntry[] =>
  JSON.parse(readFileSync(outboxFile(t), 'utf8')).entries;
/** The `text` of every Bot API request the fetch spy saw. */
function sentTexts(fetch: ReturnType<typeof okFetch>): string[] {
  return fetch.mock.calls.map((call) => {
    const init = (call as unknown[])[1] as RequestInit;
    return (JSON.parse(String(init.body)) as { text: string }).text;
  });
}

describe('Telegram/email reminders through the outbox (F31.2, F31.4, F31.5)', () => {
  it('(F31.2) the firing that shows the toast sends one message per channel, never again after a restart', async () => {
    const { clock, t } = await setup(at(2026, 10, 21, 8, 0));
    telegramOn(t);
    const fetch = okFetch();
    const first = await startReminders(t, { notify: { fetch } });
    await first.service.runNow();
    expect(first.deliverer.toasts.map((x) => x.title)).toEqual(['Còn 3 ngày: Đồ án Giải tích']);
    expect(fetch).toHaveBeenCalledTimes(1);
    // F31.4: title, due date, relative day, note path and the app link, in the UI language.
    expect(sentTexts(fetch)[0]).toBe(
      [
        '⏰ Đồ án Giải tích – hạn 24/10/2026 (còn 3 ngày)',
        `Ghi chú: ${P}`,
        `Mở trong Second Brain: http://localhost:${t.port}/#/note?path=${encodeURIComponent(P)}`,
      ].join('\n'),
    );
    const [entry] = readOutbox(t);
    expect(entry).toMatchObject({
      key: `${t.context.vault.id}|note:${P}|2026-10-24|3|telegram`,
      status: 'sent',
      attempts: 1,
    });
    expect(readFileSync(outboxFile(t), 'utf8')).not.toContain(BOT);
    await first.service.close();

    clock.set(at(2026, 10, 21, 9, 0));
    const second = await startReminders(t, { notify: { fetch } });
    await second.service.runNow();
    second.timers.tick();
    await second.service.runNow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second.deliverer.toasts).toEqual([]);
  });

  it('(F31.4) English UI: English text; "today" on the due day', async () => {
    const { t } = await setup(at(2026, 10, 24, 8, 0));
    t.settings.ui.language = 'en';
    telegramOn(t);
    const fetch = okFetch();
    const r = await startReminders(t, { notify: { fetch } });
    await r.service.runNow();
    expect(sentTexts(fetch)[0]?.split('\n')).toEqual([
      '⏰ Đồ án Giải tích – due 24 October 2026 (today)',
      `Note: ${P}`,
      `Open in Second Brain: http://localhost:${t.port}/#/note?path=${encodeURIComponent(P)}`,
    ]);
  });

  it('(F31.5) with both channels off there is no network call, no transport and no outbox file', async () => {
    const { t } = await setup(at(2026, 10, 21, 8, 0));
    // Secrets stored but the switches off.
    Object.assign(t.settings.notify.telegram, { chatId: '1', botToken: BOT });
    Object.assign(t.settings.notify.email, {
      host: 'smtp.gmail.com',
      from: 'a@b.vn',
      to: 'c@d.vn',
    });
    const fetch = okFetch();
    const createTransport = vi.fn();
    const r = await startReminders(t, { notify: { fetch, createTransport } });
    await r.service.runNow();
    expect(r.deliverer.toasts).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
    expect(existsSync(outboxFile(t))).toBe(false);
  });

  it('(F31.2) failures retry after 1 min, 5 min, 30 min, 2 h, then every 2 h; failed after 24 h', async () => {
    const { clock, t } = await setup(at(2026, 10, 21, 8, 0));
    telegramOn(t);
    const fetch = vi.fn(async () => new Response('{"ok":false}', { status: 502 }));
    const r = await startReminders(t, { notify: { fetch } });
    await r.service.runNow();
    expect(fetch).toHaveBeenCalledTimes(1);
    const start = at(2026, 10, 21, 8, 0).getTime();
    const attempts = [start];
    let next = start;
    for (let failures = 1; next + retryDelay(failures) <= start + 24 * 3_600_000; failures += 1) {
      next += retryDelay(failures);
      attempts.push(next);
    }
    for (const instant of attempts.slice(1)) {
      clock.set(new Date(instant - 1_000));
      await r.service.runNow(); // one second early: nothing
      clock.set(new Date(instant));
      await r.service.runNow();
    }
    expect(BACKOFF_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000]);
    expect(fetch).toHaveBeenCalledTimes(attempts.length);
    expect(attempts.length).toBe(15); // 0, +1 m, +5 m, +30 m, +2 h, then every 2 h within 24 h
    const [entry] = readOutbox(t);
    expect(entry).toMatchObject({ status: 'failed', lastError: 'network' });
    clock.set(at(2026, 10, 22, 12, 0));
    await r.service.runNow();
    expect(fetch).toHaveBeenCalledTimes(attempts.length);
    expect(r.deliverer.toasts).toHaveLength(1); // the toast was never affected
  });

  it('(F31.2) switching a channel off drops its pending messages for good', async () => {
    const { clock, t } = await setup(at(2026, 10, 21, 8, 0));
    telegramOn(t);
    const fetch = vi.fn(async () => new Response('{}', { status: 500 }));
    const r = await startReminders(t, { notify: { fetch } });
    await r.service.runNow();
    t.settings.notify.telegram.enabled = false;
    clock.set(at(2026, 10, 21, 8, 2));
    await r.service.runNow();
    expect(readOutbox(t)[0]).toMatchObject({ status: 'dropped', lastError: 'channel-off' });
    t.settings.notify.telegram.enabled = true;
    clock.set(at(2026, 10, 21, 9, 0));
    await r.service.runNow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('(F31.2) a send under way when the server stopped is not repeated after the restart', async () => {
    const { t } = await setup(at(2026, 10, 21, 8, 30));
    telegramOn(t);
    const key = `${t.context.vault.id}|note:${P}|2026-10-24|3`;
    // reminders.json knows the reminder fired; the outbox entry was claimed, then the power went.
    writeFileSync(
      path.join(t.context.vault.paths.stateDir, 'reminders.json'),
      JSON.stringify({
        version: 1,
        entries: [
          {
            key,
            itemId: `note:${P}`,
            path: P,
            title: 'Đồ án Giải tích',
            due: '2026-10-24',
            threshold: 3,
            firedAt: at(2026, 10, 21, 8, 0).toISOString(),
            missed: false,
            toast: 'shown',
            dismissed: false,
          },
        ],
        superseded: [],
      }),
    );
    const claimed: OutboxEntry = {
      key: `${key}|telegram`,
      reminderKey: key,
      channel: 'telegram',
      path: P,
      title: 'Đồ án Giải tích',
      due: '2026-10-24',
      threshold: 3,
      createdAt: at(2026, 10, 21, 8, 0).toISOString(),
      status: 'sending',
      attempts: 1,
      nextAttemptAt: at(2026, 10, 21, 8, 0).toISOString(),
    };
    writeFileSync(outboxFile(t), JSON.stringify({ version: 1, entries: [claimed] }));
    const fetch = okFetch();
    const r = await startReminders(t, { notify: { fetch } });
    await r.service.runNow();
    expect(fetch).not.toHaveBeenCalled();
    expect(r.logger.lines.some((l) => l.includes('1 interrupted sends are not repeated'))).toBe(
      true,
    );
    const service = r.service as typeof r.service & NotifyStatusSource;
    expect(service.notifyStatus?.().telegram).toEqual({
      pending: 0,
      lastSentAt: null,
      lastError: 'interrupted',
    });
  });
});
