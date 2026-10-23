import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HubSocket } from '../../src/ws/websocket-hub.js';
import { createMemoryLogger, createVaultTestApp, type VaultTestApp } from './vault-test-app.js';

const PORT = 47761;
const TOKEN = 'ghp_GITHUBSECRET0000000000000000000000wxyz';
const BOT = '7012345678:AAH-TELEGRAMSECRET111111111111111qrst';
const PASSWORD = 'mật khẩu ngắn';

function recordingSocket(): HubSocket & { events: { type: string; ui?: { style?: string } }[] } {
  const events: { type: string }[] = [];
  return {
    readyState: 1,
    bufferedAmount: 0,
    events,
    send: (data: string) => void events.push(JSON.parse(data)),
    terminate: () => undefined,
    on: () => undefined,
  };
}

describe('PUT/GET /api/settings: M5 fields (F35.1, F27, F31 plumbing)', () => {
  let t: VaultTestApp;
  const logger = createMemoryLogger();
  const put = (body: unknown) => t.call('PUT', '/api/settings', body);
  const stored = () =>
    JSON.parse(readFileSync(path.join(t.home, '.secondbrain', 'settings.json'), 'utf8'));
  const expectNoSecret = (body: string, label: string) => {
    for (const secret of [TOKEN, BOT, PASSWORD]) {
      expect(body.includes(secret), `${label} leaks a secret`).toBe(false);
      expect(body.includes(secret.slice(0, 12)), `${label} leaks a prefix`).toBe(false);
    }
  };

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, { persistSettings: true, logger });
  });
  afterAll(async () => t?.close());

  it('(F35.1) ui.style is saved, answered and sent to other windows', async () => {
    const socket = recordingSocket();
    t.host.hub.add(socket);
    expect((await t.call('GET', '/api/settings')).json().ui.style).toBe('bento');
    const res = await put({ ui: { style: 'calm' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().ui.style).toBe('calm');
    expect(stored().ui.style).toBe('calm');
    expect(socket.events).toEqual([{ type: 'settings:changed', ui: res.json().ui }]);
    const refused = await put({ ui: { style: 'neon' } });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.details).toEqual({ field: 'ui.style', reason: 'not-allowed' });
    await put({ ui: { style: 'bento' } });
  });

  it('system.tray is a stored switch', async () => {
    const res = await put({ system: { tray: false } });
    expect(res.json().system.tray).toBe(false);
    expect(stored().system.tray).toBe(false);
    expect((await put({ system: { tray: true } })).json().system.tray).toBe(true);
  });

  it('backup schedule and GitHub fields are cleaned, saved and answered', async () => {
    const folder = path.join(t.home, 'Sao lưu', 'Học kỳ 1');
    const res = await put({
      backup: {
        schedule: { enabled: true, folder: `  ${folder} `, time: '06:05', keep: 3 },
        github: { enabled: true, remoteUrl: ' https://github.com/nhi/kho.git ', branch: ' sb ' },
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().backup.schedule).toMatchObject({ enabled: true, folder, time: '06:05' });
    expect(res.json().backup.github).toMatchObject({
      remoteUrl: 'https://github.com/nhi/kho.git',
      branch: 'sb',
      token: { set: false, last4: null },
    });
    expect(stored().backup.schedule).toEqual({ enabled: true, folder, time: '06:05', keep: 3 });
    const cleared = await put({
      backup: { schedule: { folder: '' }, github: { remoteUrl: null } },
    });
    expect(cleared.json().backup.schedule.folder).toBeNull();
    expect(cleared.json().backup.github.remoteUrl).toBeNull();
  });

  it('notify fields are cleaned, saved and answered', async () => {
    const res = await put({
      notify: {
        telegram: { enabled: true, chatId: ' -100987654 ' },
        email: {
          host: 'smtp.gmail.com',
          port: 465,
          security: 'tls',
          user: ' Khang Nhi ',
          from: 'khangnie@gmail.com',
          to: 'nhi@truong.edu.vn',
        },
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().notify.telegram).toEqual({
      enabled: true,
      chatId: '-100987654',
      botToken: { set: false, last4: null },
    });
    expect(res.json().notify.email).toMatchObject({
      port: 465,
      security: 'tls',
      user: 'Khang Nhi',
    });
  });

  it('secrets are set by a string, answered as …last4 only, cleared by null', async () => {
    const res = await put({
      backup: { github: { token: TOKEN } },
      notify: { telegram: { botToken: BOT }, email: { password: ` ${PASSWORD} ` } },
    });
    expect(res.statusCode, res.body).toBe(200);
    expectNoSecret(res.body, 'PUT');
    expect(res.json().backup.github.token).toEqual({ set: true, last4: '…wxyz' });
    expect(res.json().notify.telegram.botToken).toEqual({ set: true, last4: '…qrst' });
    // Shorter than 16 characters: even the last 4 would give too much away.
    expect(res.json().notify.email.password).toEqual({ set: true, last4: null });
    expect(stored().backup.github.token).toBe(TOKEN);
    expect(stored().notify.email.password).toBe(PASSWORD);
    expectNoSecret((await t.call('GET', '/api/settings')).body, 'GET');
    expectNoSecret(logger.lines.join('\n'), 'the log');

    const cleared = await put({
      backup: { github: { token: null } },
      notify: { telegram: { botToken: null }, email: { password: null } },
    });
    expect(cleared.json().backup.github.token).toEqual({ set: false, last4: null });
    expect(cleared.json().notify.telegram.botToken.set).toBe(false);
    expect(cleared.json().notify.email.password.set).toBe(false);
    expect('token' in stored().backup.github).toBe(false);
    expect('botToken' in stored().notify.telegram).toBe(false);
    expect('password' in stored().notify.email).toBe(false);
  });

  it.each([
    [{ ui: { style: 'Bento' } }, 'ui.style', 'not-allowed'],
    [{ system: { tray: 'on' } }, 'system.tray', 'type'],
    [{ backup: { schedule: { time: '21:00:00' } } }, 'backup.schedule.time', 'pattern'],
    [{ backup: { schedule: { time: '24:00' } } }, 'backup.schedule.time', 'pattern'],
    [{ backup: { schedule: { keep: 2 } } }, 'backup.schedule.keep', 'out-of-range'],
    [{ backup: { schedule: { keep: 61 } } }, 'backup.schedule.keep', 'out-of-range'],
    [{ backup: { schedule: { keep: 7.5 } } }, 'backup.schedule.keep', 'type'],
    [{ backup: { schedule: { folder: 'Backups' } } }, 'backup.schedule.folder', 'not-absolute'],
    [{ backup: { schedule: { other: 1 } } }, 'backup.schedule.other', 'unknown-field'],
    [
      { backup: { github: { remoteUrl: 'http://x.vn/a' } } },
      'backup.github.remoteUrl',
      'https-only',
    ],
    [
      { backup: { github: { remoteUrl: 'git@github.com:a/b' } } },
      'backup.github.remoteUrl',
      'https-only',
    ],
    [
      { backup: { github: { remoteUrl: 'https://ghp_abc@github.com/a/b.git' } } },
      'backup.github.remoteUrl',
      'credentials-in-url',
    ],
    [{ backup: { github: { branch: '--force' } } }, 'backup.github.branch', 'branch-format'],
    [{ backup: { github: { branch: 'a..b' } } }, 'backup.github.branch', 'branch-format'],
    [{ backup: { github: { token: 'has space inside' } } }, 'backup.github.token', 'token-format'],
    [{ notify: { telegram: { chatId: 'lop k66' } } }, 'notify.telegram.chatId', 'chat-id-format'],
    [{ notify: { telegram: { botToken: 'abc' } } }, 'notify.telegram.botToken', 'bot-token-format'],
    [{ notify: { email: { port: 0 } } }, 'notify.email.port', 'out-of-range'],
    [{ notify: { email: { port: 65_536 } } }, 'notify.email.port', 'out-of-range'],
    [{ notify: { email: { security: 'ssl' } } }, 'notify.email.security', 'not-allowed'],
    [{ notify: { email: { host: 'smtp gmail.com' } } }, 'notify.email.host', 'host-format'],
    [{ notify: { email: { from: 'khangnie' } } }, 'notify.email.from', 'email-format'],
    [{ notify: { email: { to: 'Nhi <nhi@x.vn>' } } }, 'notify.email.to', 'email-format'],
    [{ notify: { email: { password: '   ' } } }, 'notify.email.password', 'too-short'],
    [{ notify: { slack: {} } }, 'notify.slack', 'unknown-field'],
  ])('refuses %j (%s: %s) and changes nothing', async (body, field, reason) => {
    const before = JSON.stringify(stored());
    const res = await put(body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
    expect(res.json().error.details).toEqual({ field, reason });
    expect(JSON.stringify(stored())).toBe(before);
  });

  it('(F31.3) security "none" only for a relay on this machine: the password never goes out in clear', async () => {
    expect(
      (await put({ notify: { email: { host: 'smtp.gmail.com', security: 'tls' } } })).statusCode,
    ).toBe(200);
    const before = JSON.stringify(stored());
    const none = await put({ notify: { email: { security: 'none' } } });
    expect(none.statusCode).toBe(400);
    expect(none.json().error.details).toEqual({
      field: 'notify.email.security',
      reason: 'tls-required',
    });
    expect(JSON.stringify(stored())).toBe(before);
    // A local relay may use it, in either order of the two saves.
    const local = await put({ notify: { email: { host: '127.0.0.1', security: 'none' } } });
    expect(local.statusCode, local.body).toBe(200);
    const away = await put({ notify: { email: { host: 'smtp.gmail.com' } } });
    expect(away.statusCode).toBe(400);
    expect(away.json().error.details).toEqual({
      field: 'notify.email.host',
      reason: 'tls-required',
    });
    expect(stored().notify.email.host).toBe('127.0.0.1');
    expect((await put({ notify: { email: { host: 'localhost' } } })).statusCode).toBe(200);
    // Clearing the host is fine; other fields can still be saved.
    expect((await put({ notify: { email: { host: null } } })).statusCode).toBe(200);
    expect((await put({ notify: { email: { from: 'a@b.vn' } } })).statusCode).toBe(200);
    const back = await put({ notify: { email: { host: 'smtp.gmail.com', security: 'starttls' } } });
    expect(back.statusCode, back.body).toBe(200);
  });

  it('a refused secret is never echoed in the error', async () => {
    const res = await put({ notify: { telegram: { botToken: `${BOT} with spaces` } } });
    expect(res.statusCode).toBe(400);
    expectNoSecret(res.body, 'the error');
  });
});
