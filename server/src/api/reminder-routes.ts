import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { REMINDERS_PLUGIN } from '../app-context/vault-plugins.js';
import { sendApiError } from '../http/api-errors.js';
import { DEFAULT_REMINDER_TIME, reminderTimeOf } from '../reminders/reminder-time.js';
import type { ReminderService } from '../reminders/reminder-types.js';

export interface ReminderRouteOptions {
  /** Global settings, for the reminder time when the plugin is not running. */
  settings?: () => { [key: string]: unknown };
}

const dismissBodySchema = {
  type: 'object',
  required: ['keys'],
  additionalProperties: false,
  properties: {
    keys: {
      type: 'array',
      minItems: 1,
      maxItems: 500,
      items: { type: 'string', minLength: 1, maxLength: 8192 },
    },
  },
} as const;

/**
 * "Nhắc nhở" (SPEC F17, §9): the reminders the server fired or caught up, and dismissing them.
 * The plugin is looked up per request (it belongs to the vault open right now); without it the
 * list is empty and `available: false`, and dismissing answers 503 `UNAVAILABLE`.
 */
export function registerReminderRoutes(
  app: FastifyInstance,
  context: AppContext,
  options: ReminderRouteOptions = {},
): void {
  const service = () => context.plugin<ReminderService>(REMINDERS_PLUGIN);

  app.get('/api/reminders', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    // Read-your-writes: a tick or a deletion just made must already be reflected.
    await context.settled();
    const reminders = service();
    if (!reminders) {
      const time = options.settings ? reminderTimeOf(options.settings()) : DEFAULT_REMINDER_TIME;
      return { available: false, time, toastSupported: false, reminders: [] };
    }
    return {
      available: true,
      time: reminders.time(),
      toastSupported: reminders.toastSupported,
      reminders: reminders.list(),
    };
  });

  app.post<{ Body: { keys: string[] } }>(
    '/api/reminders/dismiss',
    { schema: { body: dismissBodySchema } },
    async (request, reply) => {
      await context.settled();
      const reminders = service();
      if (!reminders)
        return sendApiError(reply, 503, 'UNAVAILABLE', 'Reminders are not running for this vault.');
      return { dismissed: await reminders.dismiss(request.body.keys) };
    },
  );
}
