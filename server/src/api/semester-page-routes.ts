import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { ApiError } from '../http/api-errors.js';
import { SEMESTER_ACTIONS, type SemesterAction } from '../semester/semester-page-actions.js';
import { pageText } from '../semester/semester-page-messages.js';
import { SEMESTER_PLUGIN, type SemesterPageService } from '../semester/semester-page-plugin.js';
import { languageOf } from '../reminders/reminder-messages.js';
import type { GlobalSettings } from '../config/global-settings.js';

/**
 * "Trang Học kỳ này" in Settings (SPEC F25): `GET` says whether the page is on and what state its
 * file is in (it never creates or changes anything); `POST {action}` turns it on or off,
 * regenerates it ("Tạo lại") or moves it to the trash. Without the plugin (it did not start) the
 * page counts as unavailable: `GET` answers `available: false`, `POST` 503.
 */
export function registerSemesterPageRoutes(
  app: FastifyInstance,
  context: AppContext,
  options: { settings?: () => GlobalSettings } = {},
): void {
  const service = () => context.plugin<SemesterPageService>(SEMESTER_PLUGIN);

  app.get('/api/semester-page', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    const running = service();
    if (running) return running.status();
    const language = languageOf(options.settings?.().ui.language);
    return {
      available: false,
      enabled: false,
      path: pageText(language).fileName,
      state: 'off',
      exists: false,
      edited: false,
      ours: false,
      lastGeneratedAt: null,
    };
  });

  app.post<{ Body: { action: SemesterAction } }>(
    '/api/semester-page',
    {
      schema: {
        body: {
          type: 'object',
          required: ['action'],
          properties: { action: { type: 'string', enum: [...SEMESTER_ACTIONS] } },
        },
      },
    },
    async (request) => {
      const running = service();
      if (!running) {
        throw new ApiError(503, 'UNAVAILABLE', 'The semester page is not available right now.');
      }
      const result = await running.act(request.body.action);
      // The tree, search and Today already see the new page when the answer arrives.
      await context.settled();
      return result;
    },
  );
}
