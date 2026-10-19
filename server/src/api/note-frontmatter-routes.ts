import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { planFrontmatterPatch } from '../markdown/frontmatter-patch.js';
import { guardNotePath, revisionSchema, vaultPathSchema } from './vault-route-schemas.js';

interface FrontmatterBody {
  path: string;
  expectedRevision: string;
  set?: Record<string, unknown>;
  unset?: string[];
}

/**
 * Property edits (SPEC F7): YAML-aware text patches computed on the bytes at the expected
 * revision, so only the edited keys' lines change. Invalid YAML is refused (400 `VALIDATION`,
 * `details.reason`) and the file stays byte-identical. The answer comes after the index has the
 * change, so a new `deadline` is already on Today and the calendar.
 */
export function registerNoteFrontmatterRoutes(app: FastifyInstance, context: AppContext): void {
  app.patch<{ Body: FrontmatterBody }>(
    '/api/note/frontmatter',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path', 'expectedRevision'],
          properties: {
            path: vaultPathSchema,
            expectedRevision: revisionSchema,
            set: { type: 'object', maxProperties: 100 },
            unset: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 200 } },
          },
        },
      },
    },
    async (request) => {
      const { expectedRevision, set, unset } = request.body;
      const result = await context.vault.patchWith(
        guardNotePath(request.body.path),
        expectedRevision,
        (content) => planFrontmatterPatch(content, { set, unset }),
      );
      await context.settled();
      return { revision: result.revision, content: result.content };
    },
  );
}
