import { z } from 'zod';
import { MAX_CAPTURE_LENGTH, prepareCapture } from '../api/capture-route.js';
import { dailyNoteFor, dailyNotePath } from '../api/daily-routes.js';
import { guardVaultPath } from '../security/path-guard.js';
import { isVaultError, type VaultPath, type WriteResult } from '../vault/vault-types.js';
import { defineTool, type ToolHost } from './define-tool.js';
import { assertRealPath } from './linked-path-guard.js';
import { allowNoteEdits, todayOf, type McpDeps } from './mcp-deps.js';
import { mcpWritePermission, type McpWriteOp } from './mcp-permissions.js';
import { McpToolError } from './mcp-tool-result.js';
import { MAX_NOTE_BYTES } from './read-tools.js';
import {
  appendWikiLogLine,
  paragraphAddition,
  WIKI_INDEX_PATH,
  WIKI_LOG_PATH,
} from './wiki-files.js';
import { appendToFile } from './vault-append.js';
import { assertNotGeneratedPage } from '../semester/generated-page-registry.js';

const pathArg = z.string().min(1).max(4096);
const revisionArg = z.string().regex(/^[0-9a-f]{64}$/, 'a revision is 64 lowercase hex characters');
const contentArg = z.string().max(MAX_NOTE_BYTES);
const MAX_TEXT_CODE_POINTS = 20_000;
const LINE_BREAK = /[\n\v\f\r\u0085\u2028\u2029]/;

function checkSize(content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_NOTE_BYTES) {
    throw new McpToolError('VALIDATION', 'The content is larger than 1 MB.', {
      reason: 'too-large',
    });
  }
}

/** The permission table decides, on the path the write really reaches; a refusal names its rule. */
async function permit(
  deps: McpDeps,
  op: McpWriteOp,
  path: VaultPath,
  create: boolean,
): Promise<void> {
  const decision = mcpWritePermission({
    op,
    path,
    create,
    allowNoteEdits: allowNoteEdits(deps.settings()),
    today: todayOf(deps),
  });
  if (!decision.allowed) {
    throw new McpToolError('FORBIDDEN', decision.message, { rule: decision.rule, path });
  }
  await assertRealPath(deps.context.vault, path);
}

/** `create` that answers EXISTS with the revision of the file already there. */
async function createNew(deps: McpDeps, path: VaultPath, content: string): Promise<WriteResult> {
  try {
    return await deps.context.vault.create(path, content);
  } catch (error) {
    if (!(isVaultError(error) && error.code === 'EXISTS')) throw error;
    const current = await deps.context.vault.read(path).catch(() => null);
    throw new McpToolError('EXISTS', 'The file already exists; read it and pass its revision.', {
      path,
      currentRevision: current?.revision ?? null,
    });
  }
}

async function done(deps: McpDeps, result: WriteResult, created: boolean) {
  await deps.context.settled();
  return { path: result.path, revision: result.revision, created };
}

function plainText(input: string, what: string): string {
  const text = input.normalize('NFC').trim();
  const length = Array.from(text).length;
  if (length === 0 || length > MAX_TEXT_CODE_POINTS) {
    throw new McpToolError('VALIDATION', `The ${what} must have 1 to 20,000 characters.`, {
      reason: length === 0 ? 'empty' : 'too-long',
    });
  }
  return text;
}

/** Every write tool: permission table first, then the vault service with a revision check. */
export function registerWriteTools(host: ToolHost, deps: McpDeps): void {
  const { vault } = deps.context;

  defineTool(
    host,
    {
      name: 'write_wiki_page',
      description:
        'Create a page under wiki/ (no expectedRevision) or replace it (expectedRevision = the ' +
        'revision you read). Not wiki/index.md or wiki/log.md. Up to 1 MB.',
      input: { path: pathArg, content: contentArg, expectedRevision: revisionArg.optional() },
      readOnly: false,
    },
    async ({ path: input, content, expectedRevision }) => {
      const path = guardVaultPath(input);
      await permit(deps, 'write_wiki_page', path, expectedRevision === undefined);
      checkSize(content);
      if (expectedRevision === undefined)
        return done(deps, await createNew(deps, path, content), true);
      return done(deps, await vault.write(path, content, expectedRevision), false);
    },
  );

  defineTool(
    host,
    {
      name: 'wiki_index_update',
      description:
        'Replace wiki/index.md, the only way to change it. expectedRevision: the revision you ' +
        'read, or null to create the index when it does not exist.',
      input: { content: contentArg, expectedRevision: revisionArg.nullable() },
      readOnly: false,
    },
    async ({ content, expectedRevision }) => {
      await permit(deps, 'wiki_index_update', WIKI_INDEX_PATH, expectedRevision === null);
      checkSize(content);
      if (expectedRevision === null) {
        return done(deps, await createNew(deps, WIKI_INDEX_PATH, content), true);
      }
      return done(deps, await vault.write(WIKI_INDEX_PATH, content, expectedRevision), false);
    },
  );

  defineTool(
    host,
    {
      name: 'wiki_log_append',
      description:
        'Append one line (up to 500 characters, no line breaks) at the end of wiki/log.md, e.g. ' +
        '"## [YYYY-MM-DD] query | <question>". Earlier lines are never changed.',
      input: { line: z.string().max(2000) },
      readOnly: false,
    },
    async ({ line: input }) => {
      const line = input.normalize('NFC').trim();
      const length = Array.from(line).length;
      // Every Unicode line break, so the log keeps one entry per line.
      if (length === 0 || length > 500 || LINE_BREAK.test(line)) {
        throw new McpToolError('VALIDATION', 'Give one line of 1 to 500 characters.', {
          reason: length === 0 ? 'empty' : length > 500 ? 'too-long' : 'line-break',
        });
      }
      await assertRealPath(deps.context.vault, WIKI_LOG_PATH);
      return done(deps, await appendWikiLogLine(deps.context.vault, line), false);
    },
  );

  defineTool(
    host,
    {
      name: 'capture_to_inbox',
      description:
        'Save a quick note in 0 Inbox/ (named after its first line). Always creates a new note.',
      input: { text: z.string().max(MAX_CAPTURE_LENGTH) },
      readOnly: false,
    },
    async ({ text }) => {
      const capture = prepareCapture(text, deps.context.now());
      await permit(deps, 'capture_to_inbox', capture.path, true);
      return done(deps, await vault.createUnique(capture.path, capture.content), true);
    },
  );

  defineTool(
    host,
    {
      name: 'append_to_daily',
      description:
        "Add text as a new paragraph at the end of today's daily note (created from the Daily " +
        'template when missing). Nothing else in the note changes.',
      input: { text: z.string().max(MAX_CAPTURE_LENGTH) },
      readOnly: false,
    },
    async ({ text: input }) => {
      const text = plainText(input, 'text');
      const today = todayOf(deps);
      const path = dailyNotePath(today);
      const exists = (await vault.stat(path)) !== null;
      await permit(deps, 'append_to_daily', path, !exists);
      const language = deps.settings().ui.language;
      const result = await appendToFile(vault, path, {
        addition: (current) => paragraphAddition(current, text),
        initial: async () => {
          const { content } = await dailyNoteFor(deps.context, today, language);
          return content + paragraphAddition(content, text);
        },
      });
      return done(deps, result, !exists);
    },
  );

  defineTool(
    host,
    {
      name: 'write_note',
      description:
        "Replace one of the owner's own notes at the revision you read. Only when she allowed " +
        'AI to edit personal notes in Settings; never creates notes and never writes wiki/, ' +
        'Templates/, 3 Resources/ or CLAUDE.md.',
      input: { path: pathArg, content: contentArg, expectedRevision: revisionArg },
      readOnly: false,
    },
    async ({ path: input, content, expectedRevision }) => {
      const path = guardVaultPath(input);
      const exists = (await vault.stat(path)) !== null;
      await permit(deps, 'write_note', path, !exists);
      await assertNotGeneratedPage(deps.context, path); // F25.2: GENERATED_PAGE
      checkSize(content);
      return done(deps, await vault.write(path, content, expectedRevision), false);
    },
  );
}
