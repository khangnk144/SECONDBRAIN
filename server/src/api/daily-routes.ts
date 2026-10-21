import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { isCalendarDate } from '../lib/local-date.js';
import type { FilledTemplate, TemplateLanguage } from '../templates/template-variables.js';
import { VaultError, type VaultPath } from '../vault/vault-types.js';
import { dailyNoteContent } from './new-note-content.js';

const dateSchema = { type: 'string', maxLength: 20 } as const;
const dateQuery = { type: 'object', required: ['date'], properties: { date: dateSchema } } as const;
const DAILY_NOTE = /^daily\/(\d{4}-\d{2}-\d{2})\.md$/i;

function checkDate(date: string): string {
  if (!isCalendarDate(date)) {
    throw new VaultError('VALIDATION', 'The date must be a calendar date.', {
      reason: 'invalid-date',
    });
  }
  return date;
}

export const dailyNotePath = (date: string): VaultPath => `Daily/${date}.md`;

/**
 * Content of the daily note of `date` from `Templates/Daily.md` (also used by the MCP tool
 * `append_to_daily`); an unusable template is logged by code and gives the minimal note.
 */
export function dailyNoteFor(
  context: AppContext,
  date: string,
  language: TemplateLanguage,
): Promise<FilledTemplate> {
  return dailyNoteContent(context.vault, { date, now: context.now(), language }, (code) =>
    context.logger.warn(`Daily template not used (${code}); minimal note created.`),
  );
}

/** Nearest existing daily notes before and after `date` (by the index), as vault paths. */
function neighbours(paths: VaultPath[], date: string) {
  let previous: { date: string; path: VaultPath } | null = null;
  let next: { date: string; path: VaultPath } | null = null;
  for (const path of paths) {
    const day = DAILY_NOTE.exec(path)?.[1];
    if (!day || !isCalendarDate(day)) continue;
    if (day < date && (!previous || day > previous.date)) previous = { date: day, path };
    if (day > date && (!next || day < next.date)) next = { date: day, path };
  }
  return { previous: previous?.path ?? null, next: next?.path ?? null };
}

/**
 * Daily notes (SPEC F13): `Daily/YYYY-MM-DD.md`. `GET` only looks (404 when missing, never
 * creates); `POST` creates the note once from `Templates/Daily.md` with that day's variables in
 * the UI language and answers the caret offset of `{{cursor}}`; prev/next come from the index.
 */
export function registerDailyRoutes(
  app: FastifyInstance,
  context: AppContext,
  uiLanguage: () => TemplateLanguage,
): void {
  app.get<{ Querystring: { date: string } }>(
    '/api/daily',
    { schema: { querystring: dateQuery } },
    async (request, reply) => {
      const note = await context.vault.read(dailyNotePath(checkDate(request.query.date)));
      reply.header('cache-control', 'no-store');
      return { path: note.path, revision: note.revision };
    },
  );

  app.post<{ Body: { date: string } }>(
    '/api/daily',
    { schema: { body: { type: 'object', required: ['date'], properties: { date: dateSchema } } } },
    async (request, reply) => {
      const date = checkDate(request.body.date);
      const { content, cursor } = await dailyNoteFor(context, date, uiLanguage());
      const result = await context.vault.create(dailyNotePath(date), content);
      await context.settled();
      return reply.code(201).send({ path: result.path, revision: result.revision, cursor });
    },
  );

  app.get<{ Querystring: { date: string } }>(
    '/api/daily/neighbors',
    { schema: { querystring: dateQuery } },
    async (request, reply) => {
      const date = checkDate(request.query.date);
      reply.header('cache-control', 'no-store');
      return neighbours(context.index.dailyNotePaths(), date);
    },
  );
}
