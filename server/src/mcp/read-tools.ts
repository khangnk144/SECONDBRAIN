import { z } from 'zod';
import { guardNotePath } from '../api/vault-route-schemas.js';
import { classifyPath } from '../markdown/content-classes.js';
import { guardVaultPath } from '../security/path-guard.js';
import { notFound } from '../vault/vault-errors.js';
import type { VaultPath } from '../vault/vault-types.js';
import { LIST_NOTES_DEFAULT, SEARCH_DEFAULT, textPart } from './bounded-results.js';
import { defineTool, type ToolHost } from './define-tool.js';
import type { McpDeps } from './mcp-deps.js';
import { McpToolError } from './mcp-tool-result.js';

/** Largest note `read_note` returns (bigger notes are not wiki material). */
export const MAX_NOTE_BYTES = 1024 * 1024;

const pathArg = z.string().min(1).max(4096).describe('Vault-relative path, e.g. "wiki/index.md".');
const key = (path: string) => path.normalize('NFC').toLowerCase();
const iso = (ms: number) => new Date(ms).toISOString();

/** Exists as a file or is known to the index (a deleted note's backlinks are still asked for). */
async function assertKnown(deps: McpDeps, path: VaultPath): Promise<void> {
  if ((await deps.context.vault.stat(path)) === null && !deps.context.index.getNote(path)) {
    throw notFound(path);
  }
}

/** Search, read, list and backlinks: no tool here writes. */
export function registerReadTools(host: ToolHost, deps: McpDeps): void {
  const { context } = deps;

  defineTool(
    host,
    {
      name: 'search_notes',
      description:
        'Full-text search of the vault (titles rank first, diacritic-insensitive); 20 results ' +
        'unless limit says otherwise (at most 50). Read-only.',
      input: { query: z.string().max(1000), limit: z.number().int().min(1).max(50).optional() },
      readOnly: true,
    },
    async ({ query, limit }) => {
      await context.settled();
      const found = context.index.search({ q: query, limit: limit ?? SEARCH_DEFAULT });
      const results = found.map((result) => {
        const page = (result as { page?: unknown }).page;
        return {
          path: result.path,
          title: result.title,
          class: result.class,
          matchedIn: result.matchedIn,
          snippet: result.snippet?.text ?? null,
          ...(typeof page === 'number' ? { page } : {}),
        };
      });
      return { results };
    },
  );

  defineTool(
    host,
    {
      name: 'read_note',
      description:
        'Read one Markdown note (up to 1 MB): content, revision of the whole file (pass it as ' +
        'expectedRevision when you write) and content class. At most 60,000 characters per ' +
        'call: when truncated, call again with offset = nextOffset for the rest. Read-only.',
      input: { path: pathArg, offset: z.number().int().min(0).optional() },
      readOnly: true,
    },
    async ({ path: input, offset = 0 }) => {
      const path = guardNotePath(input);
      const stat = await context.vault.stat(path);
      if (stat === null) throw notFound(path);
      if (stat.size > MAX_NOTE_BYTES) {
        throw new McpToolError('VALIDATION', 'The note is larger than 1 MB.', {
          path,
          reason: 'too-large',
          size: stat.size,
        });
      }
      const note = await context.vault.read(path);
      if (offset > note.content.length) {
        throw new McpToolError('VALIDATION', 'offset is past the end of the note.', {
          reason: 'offset',
          totalLength: note.content.length,
        });
      }
      return {
        path: note.path,
        ...textPart(note.content, offset),
        revision: note.revision,
        class: classifyPath(note.path),
        ...(note.utf8 ? {} : { utf8: false }),
      };
    },
  );

  defineTool(
    host,
    {
      name: 'list_notes',
      description:
        'List Markdown notes (path, title, class, last change), optionally in one folder; 200 ' +
        'per call (limit up to 500): call again with offset = nextOffset for more. Read-only.',
      input: {
        folder: z.string().max(4096).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).optional(),
      },
      readOnly: true,
    },
    async ({ folder, limit = LIST_NOTES_DEFAULT, offset = 0 }) => {
      const prefix = folder ? `${key(guardVaultPath(folder))}/` : '';
      await context.settled();
      const notes = context.index
        .listNotes()
        .filter((note) => key(note.path).startsWith(prefix))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      return {
        total: notes.length,
        offset,
        nextOffset: offset + limit < notes.length ? offset + limit : null,
        notes: notes.slice(offset, offset + limit).map((note) => ({
          path: note.path,
          title: note.title,
          class: note.class,
          modified: iso(note.mtimeMs),
        })),
      };
    },
  );

  defineTool(
    host,
    {
      name: 'get_backlinks',
      description: 'Notes that link to a note, each with the line holding the link. Read-only.',
      input: { path: pathArg },
      readOnly: true,
    },
    async ({ path: input }) => {
      const path = guardVaultPath(input);
      await assertKnown(deps, path);
      await context.settled();
      const backlinks = context.index.backlinks(path).map((link) => ({
        fromPath: link.fromPath,
        fromTitle: link.fromTitle,
        line: link.line,
        context: link.context,
      }));
      return { path, backlinks };
    },
  );
}
