import { describe, expect, it, vi } from 'vitest';
import {
  createTelegramChannel,
  telegramBaseUrl,
  TELEGRAM_API,
} from '../../../src/reminders/channels/telegram.js';

const TOKEN = '7012345678:AAH-TELEGRAMSECRET1111111111111111bbbb';
const message = { subject: 's', text: '⏰ Đồ án Giải tích – hạn 24/10/2026 (còn 3 ngày)' };

function answering(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('Telegram channel (F31.1, F31.5)', () => {
  it('(F31.5) posts plain text to sendMessage of the bot through the injected fetch', async () => {
    const fetch = answering(200, { ok: true, result: {} });
    const channel = createTelegramChannel({ botToken: TOKEN, chatId: '-1001234', fetch });
    expect(await channel.send(message)).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${TELEGRAM_API}/bot${TOKEN}/sendMessage`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      chat_id: '-1001234',
      text: message.text,
      disable_web_page_preview: true,
    });
    expect(init.redirect).toBe('error');
  });

  it('maps the Bot API answers to plain codes, never its text or the token', async () => {
    const cases: [number, unknown, string][] = [
      [401, { ok: false, description: 'Unauthorized' }, 'auth'],
      [404, { ok: false, description: 'Not Found' }, 'auth'],
      [400, { ok: false, description: 'Bad Request: chat not found' }, 'chat-not-found'],
      [403, { ok: false, description: 'Forbidden: bot was blocked by the user' }, 'chat-not-found'],
      [429, { ok: false, description: 'Too Many Requests: retry after 5' }, 'rate-limit'],
      [502, 'Bad Gateway', 'network'],
      [400, { ok: false, description: 'Bad Request: message is too long' }, 'failed'],
    ];
    for (const [status, body, error] of cases) {
      const channel = createTelegramChannel({
        botToken: TOKEN,
        chatId: '@kenh_rieng',
        fetch: answering(status, body),
      });
      const result = await channel.send(message);
      expect(result).toEqual({ ok: false, error });
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
  });

  it('a network failure and a 10 s timeout are told apart', async () => {
    const offline = createTelegramChannel({
      botToken: TOKEN,
      chatId: '1',
      fetch: vi.fn(async () => {
        throw new TypeError(`fetch failed for ${TELEGRAM_API}/bot${TOKEN}/sendMessage`);
      }),
    });
    expect(await offline.send(message)).toEqual({ ok: false, error: 'network' });
    const hanging = createTelegramChannel({
      botToken: TOKEN,
      chatId: '1',
      timeoutMs: 20,
      fetch: vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      ),
    });
    expect(await hanging.send(message)).toEqual({ ok: false, error: 'timeout' });
  });

  it('SB_TELEGRAM_API_URL points the channel at a local mock (e2e only)', () => {
    expect(telegramBaseUrl({})).toBe(TELEGRAM_API);
    expect(telegramBaseUrl({ SB_TELEGRAM_API_URL: 'http://127.0.0.1:47798/' })).toBe(
      'http://127.0.0.1:47798',
    );
    expect(telegramBaseUrl({ SB_TELEGRAM_API_URL: 'javascript:alert(1)' })).toBe(TELEGRAM_API);
  });

  it('(F31.3) SB_TELEGRAM_API_URL is honoured only on this machine: the token never leaves it', () => {
    const base = (url: string) => telegramBaseUrl({ SB_TELEGRAM_API_URL: url });
    expect(base('http://localhost:47798')).toBe('http://localhost:47798');
    expect(base('https://127.0.0.1:8443/api/')).toBe('https://127.0.0.1:8443/api');
    expect(base('http://[::1]:47798')).toBe('http://[::1]:47798');
    for (const elsewhere of [
      'http://evil.example:80',
      'https://api.telegram.org.evil.example',
      'http://192.168.1.20:8080',
      'http://127.0.0.1.nip.io:8080',
      'http://user:pw@127.0.0.1:47798',
      'http://127.0.0.1:47798/?x=1',
      'ftp://127.0.0.1/',
      'http://127.0.0.1:47798/ x',
    ]) {
      expect(base(elsewhere)).toBe(TELEGRAM_API);
    }
  });

  it('closing the app aborts a send in flight: interrupted, not a network error', async () => {
    const closing = new AbortController();
    const channel = createTelegramChannel({
      botToken: TOKEN,
      chatId: '123',
      fetch: (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    });
    const sending = channel.send(message, closing.signal);
    closing.abort();
    expect(await sending).toEqual({ ok: false, error: 'interrupted' });
    expect(await channel.send(message, closing.signal)).toEqual({
      ok: false,
      error: 'interrupted',
    });
  });
});
