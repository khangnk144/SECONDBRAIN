/**
 * Which reminder channels are on and set up (SPEC F31.1), and the channel object for one of them
 * built from the settings of this moment (a change in Settings applies to the next message).
 * Nothing here touches the network: only `send` of a built channel does.
 */
import type { NotifySettings } from '../../config/settings-sections-m5.js';
import type { ChannelDeps, NotifyChannel, NotifyChannelName } from './channel-types.js';
import { createEmailChannel } from './email.js';
import { createTelegramChannel, telegramBaseUrl } from './telegram.js';

/** Every field the channel needs is set (a user name needs its password). */
export function isChannelConfigured(name: NotifyChannelName, notify: NotifySettings): boolean {
  if (name === 'telegram') return Boolean(notify.telegram.botToken && notify.telegram.chatId);
  const email = notify.email;
  if (!email.host || !email.from || !email.to) return false;
  return !email.user || Boolean(email.password);
}

/** Switched on in Settings (configured or not). */
export function isChannelOn(name: NotifyChannelName, notify: NotifySettings): boolean {
  return notify[name].enabled === true;
}

/** The channel, or null when it is not set up. */
export function buildChannel(
  name: NotifyChannelName,
  notify: NotifySettings,
  deps: ChannelDeps = {},
): NotifyChannel | null {
  if (!isChannelConfigured(name, notify)) return null;
  if (name === 'telegram') {
    return createTelegramChannel({
      botToken: notify.telegram.botToken as string,
      chatId: notify.telegram.chatId as string,
      fetch: deps.fetch ?? globalThis.fetch,
      baseUrl: telegramBaseUrl(deps.env ?? process.env),
      timeoutMs: deps.telegramTimeoutMs,
    });
  }
  return createEmailChannel({
    email: notify.email,
    createTransport: deps.createTransport,
    timeoutMs: deps.emailTimeoutMs,
  });
}
