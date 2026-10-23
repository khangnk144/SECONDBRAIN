import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { REMINDERS_PLUGIN } from '../app-context/vault-plugins.js';
import type { GlobalSettings } from '../config/global-settings.js';
import { normalizeNotify } from '../config/settings-sections-m5.js';
import {
  NOTIFY_CHANNELS,
  type ChannelDeps,
  type NotifyChannelName,
} from '../reminders/channels/channel-types.js';
import { buildChannel } from '../reminders/channels/notify-channels.js';
import { testMessage } from '../reminders/channels/notify-messages.js';
import type { NotifyStatusSource } from '../reminders/notify-outbox-service.js';
import { languageOf } from '../reminders/reminder-messages.js';

export interface NotifyRouteOptions {
  settings: () => GlobalSettings;
  /** Network of the channels (tests inject fetch and the SMTP transport). */
  channels?: ChannelDeps;
}

const testBodySchema = {
  type: 'object',
  required: ['channel'],
  additionalProperties: false,
  properties: { channel: { type: 'string', enum: NOTIFY_CHANNELS } },
} as const;

/**
 * Telegram/email reminders (SPEC F31): "Gửi thử" sends one test message now with the settings as
 * they are (also before the channel is switched on: that is how she checks it), and the status
 * line per channel from the reminder outbox. A failed send answers 200 `{ ok: false, error }`
 * with a code only – never the service's text, the token or the password.
 */
export function registerNotifyRoutes(
  app: FastifyInstance,
  context: AppContext,
  options: NotifyRouteOptions,
): void {
  const busy = new Set<NotifyChannelName>();

  app.post<{ Body: { channel: NotifyChannelName } }>(
    '/api/notify/test',
    { schema: { body: testBodySchema } },
    async (request) => {
      const { channel: name } = request.body;
      if (busy.has(name)) return { ok: false, error: 'busy' };
      const settings = options.settings();
      const channel = buildChannel(name, normalizeNotify(settings.notify), options.channels);
      if (!channel) return { ok: false, error: 'not-configured' };
      busy.add(name);
      try {
        const result = await channel.send(testMessage(languageOf(settings.ui?.language)));
        if (!result.ok) context.logger.warn(`Test message via ${name} failed (${result.error}).`);
        return result;
      } finally {
        busy.delete(name);
      }
    },
  );

  app.get('/api/notify/status', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    const reminders = context.plugin<NotifyStatusSource & { close(): Promise<void> }>(
      REMINDERS_PLUGIN,
    );
    const status = reminders?.notifyStatus?.();
    return status ? { available: true, ...status } : { available: false };
  });
}
