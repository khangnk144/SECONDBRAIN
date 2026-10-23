import net from 'node:net';
import { createTransport } from 'nodemailer';
import { afterEach, describe, expect, it } from 'vitest';
import type { EmailSettings } from '../../../src/config/settings-sections-m5.js';
import type { SmtpTransportOptions } from '../../../src/reminders/channels/channel-types.js';
import {
  createEmailChannel,
  emailError,
  smtpOptions,
} from '../../../src/reminders/channels/email.js';
import { startFakeSmtpServer, type FakeSmtpServer } from './fake-smtp-server.js';

const PASSWORD = 'smtp mật khẩu cccc';
const message = {
  subject: '⏰ Đồ án Giải tích – hạn 24/10/2026 (còn 3 ngày)',
  text: '⏰ Đồ án Giải tích – hạn 24/10/2026 (còn 3 ngày)\nGhi chú: 1 Projects/Đồ án Giải tích.md',
};

function email(overrides: Partial<EmailSettings> = {}): EmailSettings {
  return {
    enabled: true,
    host: '127.0.0.1',
    port: 587,
    security: 'none',
    user: 'khangnie@truong.edu.vn',
    from: 'khangnie@truong.edu.vn',
    to: 'khangnie@gmail.com',
    password: PASSWORD,
    ...overrides,
  };
}

let server: FakeSmtpServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('email channel (F31.1, F31.5)', () => {
  it('(F31.5) sends plain text with nodemailer (JSON transport: nothing leaves the machine)', async () => {
    let options: SmtpTransportOptions | undefined;
    let mail: unknown;
    const channel = createEmailChannel({
      email: email({ security: 'starttls' }),
      createTransport: (given) => {
        options = given;
        const json = createTransport({ jsonTransport: true });
        return {
          sendMail: async (m) =>
            (mail = JSON.parse(((await json.sendMail(m)) as { message: string }).message)),
          close: () => json.close(),
        };
      },
    });
    expect(await channel.send(message)).toEqual({ ok: true });
    expect(options).toMatchObject({
      host: '127.0.0.1',
      port: 587,
      secure: false,
      requireTLS: true,
      ignoreTLS: false,
      auth: { user: 'khangnie@truong.edu.vn', pass: PASSWORD },
      connectionTimeout: 15_000,
      logger: false,
    });
    expect(mail).toMatchObject({
      from: { address: 'khangnie@truong.edu.vn' },
      to: [{ address: 'khangnie@gmail.com' }],
      subject: message.subject,
      text: message.text,
    });
  });

  it('(F31.3) "none" with a server that is not on this machine is refused before any connection', async () => {
    let made = 0;
    const transport = () => {
      made += 1;
      return { sendMail: async () => ({}), close: () => undefined };
    };
    const remote = createEmailChannel({
      email: email({ host: 'smtp.gmail.com', security: 'none' }),
      createTransport: transport,
    });
    expect(await remote.send(message)).toEqual({ ok: false, error: 'tls-required' });
    expect(made).toBe(0);
    for (const host of ['localhost', '127.0.0.1', '127.0.0.53']) {
      const local = createEmailChannel({ email: email({ host }), createTransport: transport });
      expect(await local.send(message)).toEqual({ ok: true });
    }
    expect(made).toBe(3);
  });

  it('closing the app aborts a send in flight: interrupted, and the transport is closed', async () => {
    const closing = new AbortController();
    let closed = false;
    const channel = createEmailChannel({
      email: email(),
      createTransport: () => ({
        sendMail: () => new Promise(() => undefined), // a server that never answers
        close: () => void (closed = true),
      }),
    });
    const sending = channel.send(message, closing.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    closing.abort();
    expect(await sending).toEqual({ ok: false, error: 'interrupted' });
    expect(closed).toBe(true);
  });

  it('security choices map to TLS from the start, STARTTLS or none', () => {
    expect(smtpOptions(email({ security: 'tls', port: 465 }), 1)).toMatchObject({
      secure: true,
      requireTLS: false,
      ignoreTLS: false,
    });
    expect(smtpOptions(email({ security: 'none' }), 1)).toMatchObject({
      secure: false,
      requireTLS: false,
      ignoreTLS: true,
    });
    expect(smtpOptions(email({ user: null }), 1)).not.toHaveProperty('auth');
  });

  it('a real SMTP exchange with a local fake server: delivered, then a refused login is smtp-auth', async () => {
    server = await startFakeSmtpServer({ acceptLogin: true });
    const ok = createEmailChannel({ email: email({ port: server.port }) });
    expect(await ok.send(message)).toEqual({ ok: true });
    expect(server.messages).toHaveLength(1);
    expect(server.messages[0]).toContain('Subject:');
    await server.close();

    server = await startFakeSmtpServer({ acceptLogin: false });
    const refused = createEmailChannel({ email: email({ port: server.port }) });
    const result = await refused.send(message);
    expect(result).toEqual({ ok: false, error: 'smtp-auth' });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it('nobody listening is smtp-connect; a silent server is a timeout', async () => {
    const closed = net.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const refused = createEmailChannel({ email: email({ port }), timeoutMs: 2_000 });
    expect(await refused.send(message)).toEqual({ ok: false, error: 'smtp-connect' });

    const silent = net.createServer(() => undefined); // accepts, never greets
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    try {
      const quiet = createEmailChannel({
        email: email({ port: (silent.address() as net.AddressInfo).port }),
        timeoutMs: 100,
      });
      expect(await quiet.send(message)).toEqual({ ok: false, error: 'timeout' });
    } finally {
      silent.close();
    }
  });

  it('error codes: auth, connect, rejected, unknown; incomplete settings are not-configured', async () => {
    expect(emailError({ code: 'EAUTH', responseCode: 535 })).toBe('smtp-auth');
    expect(emailError({ code: 'ECONNECTION' })).toBe('smtp-connect');
    expect(emailError({ code: 'EDNS' })).toBe('smtp-connect');
    expect(emailError({ code: 'EENVELOPE', responseCode: 550 })).toBe('rejected');
    expect(emailError({ responseCode: 554 })).toBe('rejected');
    expect(emailError(new Error('?'))).toBe('failed');
    const incomplete = createEmailChannel({ email: email({ to: null }) });
    expect(await incomplete.send(message)).toEqual({ ok: false, error: 'not-configured' });
  });
});
