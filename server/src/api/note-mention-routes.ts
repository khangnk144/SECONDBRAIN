import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { planLinkMention } from '../mentions/link-mention.js';
import { findUnlinkedMentions } from '../mentions/unlinked-mentions.js';
import { VaultError } from '../vault/vault-types.js';
import {
  guardNotePath,
  pathQuerySchema,
  revisionSchema,
  vaultPathSchema,
  type PathQuery,
} from './vault-route-schemas.js';

interface LinkMentionBody {
  path: string;
  expectedRevision: string;
  start: number;
  end: number;
  target: string;
}

const offsetSchema = { type: 'integer', minimum: 0, maximum: 2 ** 31 } as const;

/** Unlinked mentions of a note (SPEC F5) and turning one of them into a link. */
export function registerNoteMentionRoutes(app: FastifyInstance, context: AppContext): void {
  app.get<{ Querystring: PathQuery }>(
    '/api/note/mentions',
    { schema: { querystring: pathQuerySchema } },
    async (request, reply) => {
      const path = guardNotePath(request.query.path);
      const note = await context.vault.stat(path);
      if (!note) throw new VaultError('NOT_FOUND', `Not found: ${path}`, { path });
      reply.header('cache-control', 'no-store');
      return {
        mentions: await findUnlinkedMentions(
          { vault: context.vault, index: context.index },
          note.path,
        ),
      };
    },
  );

  app.post<{ Body: LinkMentionBody }>(
    '/api/note/link-mention',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path', 'expectedRevision', 'start', 'end', 'target'],
          properties: {
            path: vaultPathSchema,
            expectedRevision: revisionSchema,
            start: offsetSchema,
            end: offsetSchema,
            target: vaultPathSchema,
          },
        },
      },
    },
    async (request) => {
      const { expectedRevision, start, end } = request.body;
      const path = guardNotePath(request.body.path);
      const targetPath = guardNotePath(request.body.target);
      const target = await context.vault.stat(targetPath);
      if (!target) {
        throw new VaultError('NOT_FOUND', `Not found: ${targetPath}`, { path: targetPath });
      }
      const notePath = (await context.vault.stat(path))?.path ?? path;
      if (notePath === target.path) {
        throw new VaultError('VALIDATION', 'A note cannot link a mention of itself.', {
          reason: 'self-link',
        });
      }
      // Resolution must see every change the app already made (a note created a moment ago).
      await context.settled();
      const result = await context.vault.patchWith(path, expectedRevision, (content) =>
        planLinkMention(content, {
          notePath,
          start,
          end,
          target: target.path,
          catalog: context.index.linkCatalog(),
        }),
      );
      await context.settled();
      return { revision: result.revision };
    },
  );
}
