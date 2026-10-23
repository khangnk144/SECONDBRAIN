/**
 * Telegram channel (SPEC F31): `POST <api>/bot<token>/sendMessage` with the chat id and plain
 * text (no parse mode, so a title can never be read as markup), 10 s timeout, through the
 * injected `fetch`. The token is only in the request URL: errors carry a code, never the URL.
 */
import { isLoopbackHostName } from '../../lib/loopback-host.js';
import type { ChannelError, ChannelResult, NotifyChannel } from './channel-types.js';

export const TELEGRAM_TIMEOUT_MS = 10_000;
export const TELEGRAM_API = 'https://api.telegram.org';
/**
 * e2e only: a local stand-in for the Bot API (`http://127.0.0.1:<port>`). Honoured only for an
 * http(s) URL on this machine (`localhost`, `127.x.x.x`, `[::1]`) without credentials, query or
 * fragment: the bot token travels in the request path, so an environment variable must never be
 * able to send it to another computer, let alone in clear. Anything else means the real API.
 */
export const TELEGRAM_URL_ENV = 'SB_TELEGRAM_API_URL';

export function telegramBaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const override = env[TELEGRAM_URL_ENV]?.trim();
  if (!override || /\s/.test(override)) return TELEGRAM_API;
  let url: URL;
  try {
    url = new URL(override);
  } catch {
    return TELEGRAM_API;
  }
  const local =
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    isLoopbackHostName(url.hostname) &&
    !url.username &&
    !url.password &&
    url.search === '' &&
    url.hash === '';
  return local ? override.replace(/\/+$/, '') : TELEGRAM_API;
}

/** Bot API answers → code. `description` is read for "chat not found" only, never kept. */
export function telegramError(status: number, description: string): ChannelError {
  if (status === 401 || status === 404) return 'auth'; // wrong or revoked token
  if (status === 400 && /chat not found|chat_id is empty|peer_id_invalid/i.test(description))
    return 'chat-not-found';
  if (status === 403) return 'chat-not-found'; // blocked, or never started by this chat
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'network';
  return 'failed';
}

export interface TelegramOptions {
  botToken: string;
  chatId: string;
  fetch: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

async function description(response: Response): Promise<string> {
  try {
    const text = (await response.text()).slice(0, 4096);
    const parsed = JSON.parse(text) as { description?: unknown };
    return typeof parsed.description === 'string' ? parsed.description : '';
  } catch {
    return '';
  }
}

export function createTelegramChannel(options: TelegramOptions): NotifyChannel {
  const base = options.baseUrl ?? TELEGRAM_API;
  return {
    name: 'telegram',
    async send(message, signal): Promise<ChannelResult> {
      if (signal?.aborted) return { ok: false, error: 'interrupted' };
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs ?? TELEGRAM_TIMEOUT_MS);
      const stop = () => controller.abort();
      signal?.addEventListener('abort', stop, { once: true });
      try {
        const response = await options.fetch(`${base}/bot${options.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: options.chatId,
            text: message.text,
            disable_web_page_preview: true,
          }),
          redirect: 'error',
          signal: controller.signal,
        });
        if (response.ok) {
          await response.body?.cancel().catch(() => undefined);
          return { ok: true };
        }
        return { ok: false, error: telegramError(response.status, await description(response)) };
      } catch {
        if (signal?.aborted) return { ok: false, error: 'interrupted' };
        return { ok: false, error: timedOut ? 'timeout' : 'network' };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
      }
    },
  };
}
