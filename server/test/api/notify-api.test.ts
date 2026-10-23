import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRemindersPlugin } from '../../src/reminders/reminders-plugin.js';
import { manualTimers, recordingDeliverer } from '../reminders/helpers/reminder-test-host.js';
import { startFakeSmtpServer, type FakeSmtpServer } from '../reminders/notify/fake-smtp-server.js';
import { createMemoryLogger, createVaultTestApp, type VaultTestApp } from './vault-test-app.js';

const BOT = '7012345678:AAH-TELEGRAMSECRET1111111111111111bbbb';
const PASSWORD = 'smtp mật khẩu cccc';

let t: VaultTestApp | undefined;
let smtp: FakeSmtpServer | undefined;
afterEach(async () => {
  await t?.close();
  await smtp?.close();
  t = undefined;
  smtp = undefined;
});

async function setup(answer: () => Response) {
  const fetch = vi.fn(async () => answer());
  const logger = createMemoryLogger();
  t = await createVaultTestApp(47865, {
    watcher: false,
    logger,
    vaultRoutes: { notify: { fetch } },
    plugins: [createRemindersPlugin({ timers: manualTimers(), deliver: recordingDeliverer() })],
  });
  return { t, fetch, logger };
}

describe('POST /api/notify/test (F31.1)', () => {
  it('(F31.1) "Gửi thử" sends one Telegram test message, also before the channel is on', async () => {
    const { t, fetch } = await setup(() => new Response('{"ok":true}'));
    expect((await t.call('POST', '/api/notify/test', { channel: 'telegram' })).json()).toEqual({
      ok: false,
      error: 'not-configured',
    });
    expect(fetch).not.toHaveBeenCalled();
    Object.assign(t.settings.notify.telegram, { chatId: '@kenh_rieng', botToken: BOT });
    const res = await t.call('POST', '/api/notify/test', { channel: 'telegram' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const init = (fetch.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(JSON.parse(String(init.body)).text).toBe(
      'Đây là tin nhắn thử từ Second Brain. Nhắc nhở deadline sẽ đến đây.',
    );
    expect((await t.call('POST', '/api/notify/test', { channel: 'sms' })).statusCode).toBe(400);
  });

  it('(F31.3) a refused test answers a code; the token is in no response and no log line', async () => {
    let status = 401;
    const { t, logger } = await setup(
      () => new Response(JSON.stringify({ ok: false, description: `bad ${BOT}` }), { status }),
    );
    Object.assign(t.settings.notify.telegram, { chatId: '1', botToken: BOT });
    const bodies: string[] = [];
    for (const [code, error] of [
      [401, 'auth'],
      [400, 'failed'],
      [403, 'chat-not-found'],
    ] as const) {
      status = code;
      const res = await t.call('POST', '/api/notify/test', { channel: 'telegram' });
      bodies.push(res.body);
      expect(res.json()).toEqual({ ok: false, error });
    }
    bodies.push((await t.call('GET', '/api/notify/status')).body);
    bodies.push((await t.call('GET', '/api/settings')).body);
    for (const body of bodies) expect(body).not.toContain(BOT);
    expect(logger.lines.join('\n')).not.toContain(BOT);
    expect(logger.lines.some((l) => l.includes('Test message via telegram failed (auth)'))).toBe(
      true,
    );
  });

  it('(F31.1) email test through a local SMTP server: sent, then smtp-auth; password never echoed', async () => {
    const { t, logger } = await setup(() => new Response('{}'));
    smtp = await startFakeSmtpServer({ acceptLogin: true });
    Object.assign(t.settings.notify.email, {
      host: '127.0.0.1',
      port: smtp.port,
      security: 'none',
      user: 'khangnie',
      password: PASSWORD,
      from: 'khangnie@truong.edu.vn',
      to: 'khangnie@gmail.com',
    });
    expect((await t.call('POST', '/api/notify/test', { channel: 'email' })).json()).toEqual({
      ok: true,
    });
    expect(smtp.messages[0]).toContain('=?UTF-8?');
    await smtp.close();
    smtp = await startFakeSmtpServer({ acceptLogin: false });
    t.settings.notify.email.port = smtp.port;
    const refused = await t.call('POST', '/api/notify/test', { channel: 'email' });
    expect(refused.json()).toEqual({ ok: false, error: 'smtp-auth' });
    expect(refused.body).not.toContain(PASSWORD);
    expect(logger.lines.join('\n')).not.toContain(PASSWORD);
  });

  it('GET /api/notify/status reads the outbox of the reminders plugin', async () => {
    const { t } = await setup(() => new Response('{}'));
    expect((await t.call('GET', '/api/notify/status')).json()).toEqual({
      available: true,
      telegram: { pending: 0, lastSentAt: null, lastError: null },
      email: { pending: 0, lastSentAt: null, lastError: null },
    });
  });
});
