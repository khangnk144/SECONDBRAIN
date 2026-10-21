import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { captureNoteName } from '../capture/capture-note-name.js';
import { toLocalDate } from '../lib/local-date.js';
import { VaultError } from '../vault/vault-types.js';
import { blankNoteContent } from './new-note-content.js';

const MAX_CODE_POINTS = 20_000;

/**
 * Quick capture (SPEC F12): `0 Inbox/<name>.md` with the properties every app-created note gets
 * (`type: note`, `created`), a blank line and the text as typed (NFC, LF line endings, trailing
 * whitespace dropped, one final newline). The name comes from the first line, made unique with
 * ` 2`, ` 3`, … The answer comes after the index has the note, so the Inbox count is current.
 */
export function registerCaptureRoute(app: FastifyInstance, context: AppContext): void {
  app.post<{ Body: { text: string } }>(
    '/api/capture',
    {
      schema: {
        body: {
          type: 'object',
          required: ['text'],
          properties: { text: { type: 'string', maxLength: 2 * MAX_CODE_POINTS } },
        },
      },
    },
    async (request, reply) => {
      const text = request.body.text.normalize('NFC').replace(/\r\n?/g, '\n').trimEnd();
      const length = Array.from(text.trim()).length;
      if (length === 0 || length > MAX_CODE_POINTS) {
        throw new VaultError('VALIDATION', 'The text must have 1 to 20,000 characters.', {
          reason: length === 0 ? 'empty' : 'too-long',
        });
      }
      const now = context.now();
      const content = `${blankNoteContent(toLocalDate(now))}${text}\n`;
      const result = await context.vault.createUnique(
        `0 Inbox/${captureNoteName(text, now)}.md`,
        content,
      );
      await context.settled();
      return reply.code(201).send({ path: result.path, revision: result.revision });
    },
  );
}
