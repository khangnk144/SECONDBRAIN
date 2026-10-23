import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import type { BacklinkRef, OutlinkRef } from '../index/index-types.js';
import { classifyPath, noteTitleFromPath } from '../markdown/content-classes.js';
import type { ContentClass } from '../markdown/markdown-types.js';
import { parseNote } from '../markdown/parse-note.js';
import { VaultError, type NoteRead, type VaultPath } from '../vault/vault-types.js';
import { toLocalDate } from '../lib/local-date.js';
import type { TemplateLanguage } from '../templates/template-variables.js';
import { newNoteContent } from './new-note-content.js';
import { assertNotGeneratedPage } from '../semester/generated-page-registry.js';
import {
  guardNotePath,
  pathQuerySchema,
  revisionSchema,
  vaultPathSchema,
  type PathQuery,
} from './vault-route-schemas.js';

export interface NoteResponse {
  path: VaultPath;
  content: string;
  revision: string;
  /** False when the file is not valid UTF-8: `content` is a lossy decode and saving is refused. */
  utf8: boolean;
  /** Last modification, epoch milliseconds (the file's mtime; SPEC §4.3 has no `updated` key). */
  mtime: number;
  frontmatter: Record<string, unknown> | null;
  frontmatterError: string | null;
  backlinks: BacklinkRef[];
  outlinks: OutlinkRef[];
  tags: string[];
  class: ContentClass;
}

/** Properties and tags of exactly the bytes being returned: from the index when it is current. */
function noteMetadata(context: AppContext, note: NoteRead) {
  const indexed = context.index.getNote(note.path);
  if (indexed && indexed.revision === note.revision) {
    return {
      frontmatter: indexed.frontmatter,
      frontmatterError: indexed.frontmatterError,
      tags: context.index.noteTags(note.path),
    };
  }
  // Edited outside the app a moment ago and not indexed yet: parse what we just read.
  const parsed = parseNote(note.content);
  const tags = new Map<string, string>();
  for (const tag of parsed.tags) if (!tags.has(tag.norm)) tags.set(tag.norm, tag.tag);
  return {
    frontmatter: parsed.frontmatter.data,
    frontmatterError: parsed.frontmatter.error,
    tags: [...tags.values()],
  };
}

export function registerNoteRoutes(
  app: FastifyInstance,
  context: AppContext,
  uiLanguage: () => TemplateLanguage,
): void {
  app.get<{ Querystring: PathQuery }>(
    '/api/note',
    { schema: { querystring: pathQuerySchema } },
    async (request, reply): Promise<NoteResponse> => {
      const note = await context.vault.read(guardNotePath(request.query.path));
      reply.header('cache-control', 'no-store');
      return {
        path: note.path,
        content: note.content,
        revision: note.revision,
        utf8: note.utf8,
        mtime: note.mtimeMs,
        ...noteMetadata(context, note),
        backlinks: context.index.backlinks(note.path),
        outlinks: context.index.outlinks(note.path),
        class: classifyPath(note.path),
      };
    },
  );

  app.put<{ Body: SaveBody }>(
    '/api/note',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path', 'content', 'expectedRevision'],
          properties: {
            path: vaultPathSchema,
            content: { type: 'string' },
            expectedRevision: revisionSchema,
            conflictCopy: { type: 'boolean' },
          },
        },
      },
    },
    async (request) => {
      const { content, expectedRevision, conflictCopy } = request.body;
      const path = guardNotePath(request.body.path);
      await assertNotGeneratedPage(context, path); // F25.2
      // "Giữ bản của tôi": the disk version shown by the conflict UI goes to the trash first.
      const result = conflictCopy
        ? await context.vault.writeKeepingConflictCopy(path, content, expectedRevision)
        : await context.vault.write(path, content, expectedRevision);
      await context.settled();
      return 'trashId' in result
        ? { revision: result.revision, trashId: result.trashId }
        : { revision: result.revision };
    },
  );

  app.post<{ Body: CreateBody }>(
    '/api/note',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path'],
          properties: {
            path: vaultPathSchema,
            template: vaultPathSchema,
            title: { type: 'string', maxLength: 1000 },
            unique: { type: 'boolean' },
            content: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { template, content: exact, unique = false } = request.body;
      const path = guardNotePath(request.body.path);
      if (exact !== undefined && template !== undefined && template !== '') {
        throw new VaultError('VALIDATION', 'Give either a template or the content, not both.', {
          reason: 'content-and-template',
        });
      }
      const title = request.body.title ?? noteTitleFromPath(path);
      const now = context.now();
      // Template variables in the UI language; `cursor` = where `{{cursor}}` was (F14.2).
      const { content, cursor } =
        exact !== undefined
          ? { content: exact, cursor: null }
          : await newNoteContent(context.vault, template, {
              title,
              date: toLocalDate(now),
              now,
              language: uiLanguage(),
            });
      const result = unique
        ? await context.vault.createUnique(path, content)
        : await context.vault.create(path, content);
      await context.settled();
      return reply.code(201).send({ path: result.path, revision: result.revision, cursor });
    },
  );
}

interface SaveBody {
  path: string;
  content: string;
  expectedRevision: string;
  conflictCopy?: boolean;
}

interface CreateBody {
  path: string;
  template?: string;
  title?: string;
  unique?: boolean;
  content?: string;
}
