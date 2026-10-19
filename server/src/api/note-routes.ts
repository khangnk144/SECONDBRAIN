import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import type { BacklinkRef, OutlinkRef } from '../index/index-types.js';
import { classifyPath, noteTitleFromPath } from '../markdown/content-classes.js';
import type { ContentClass } from '../markdown/markdown-types.js';
import { parseNote } from '../markdown/parse-note.js';
import type { NoteRead, VaultPath } from '../vault/vault-types.js';
import { newNoteContent, templateVariablesAt } from './new-note-content.js';
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

export function registerNoteRoutes(app: FastifyInstance, context: AppContext): void {
  const { vault, index } = context;

  app.get<{ Querystring: PathQuery }>(
    '/api/note',
    { schema: { querystring: pathQuerySchema } },
    async (request, reply): Promise<NoteResponse> => {
      const note = await vault.read(guardNotePath(request.query.path));
      reply.header('cache-control', 'no-store');
      return {
        path: note.path,
        content: note.content,
        revision: note.revision,
        utf8: note.utf8,
        mtime: note.mtimeMs,
        ...noteMetadata(context, note),
        backlinks: index.backlinks(note.path),
        outlinks: index.outlinks(note.path),
        class: classifyPath(note.path),
      };
    },
  );

  app.put<{ Body: { path: string; content: string; expectedRevision: string } }>(
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
          },
        },
      },
    },
    async (request) => {
      const { content, expectedRevision } = request.body;
      const result = await vault.write(guardNotePath(request.body.path), content, expectedRevision);
      await context.settled();
      return { revision: result.revision };
    },
  );

  app.post<{ Body: { path: string; template?: string; title?: string } }>(
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
          },
        },
      },
    },
    async (request, reply) => {
      const path = guardNotePath(request.body.path);
      const title = request.body.title ?? noteTitleFromPath(path);
      const vars = templateVariablesAt(title, context.now());
      const content = await newNoteContent(vault, request.body.template, vars);
      const result = await vault.create(path, content);
      await context.settled();
      return reply.code(201).send({ path: result.path, revision: result.revision });
    },
  );
}
