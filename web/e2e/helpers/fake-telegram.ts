// A stand-in for the Telegram Bot API on 127.0.0.1 (the server reaches it through
// `SB_TELEGRAM_API_URL`): records every `sendMessage` and answers ok, or the error a test asks for.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TelegramMessage {
  token: string;
  chatId: string;
  text: string;
}

export interface FakeTelegram {
  readonly url: string;
  readonly messages: TelegramMessage[];
  /** `ok` (default), `unauthorized` (401) or `chat-not-found` (400). */
  answer: 'ok' | 'unauthorized' | 'chat-not-found';
  close(): Promise<void>;
}

export async function startFakeTelegram(): Promise<FakeTelegram> {
  const messages: TelegramMessage[] = [];
  const fake: FakeTelegram = {
    url: '',
    messages,
    answer: 'ok',
    close: async () => {},
  };
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      const match = /^\/bot([^/]+)\/sendMessage$/.exec(request.url ?? '');
      const reply = (status: number, value: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      if (!match || request.method !== 'POST') return reply(404, { ok: false });
      if (fake.answer === 'unauthorized') {
        return reply(401, { ok: false, error_code: 401, description: 'Unauthorized' });
      }
      if (fake.answer === 'chat-not-found') {
        return reply(400, { ok: false, description: 'Bad Request: chat not found' });
      }
      const json = JSON.parse(body) as { chat_id: string | number; text: string };
      messages.push({
        token: decodeURIComponent(match[1]!),
        chatId: String(json.chat_id),
        text: json.text,
      });
      return reply(200, { ok: true, result: { message_id: messages.length } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  Object.assign(fake, {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
  return fake;
}
