import { lstat } from 'node:fs/promises';
import nodePath from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { SOURCES_PLUGIN } from '../app-context/vault-plugins.js';
import {
  buildResourceListing,
  resourcePaths,
  type FileFacts,
  type ResourceText,
} from '../attachments/resource-listing.js';
import { sourceFormatOf } from '../sources/source-formats.js';
import type { SourceTextService } from '../sources/source-types.js';
import type { VaultPath } from '../vault/vault-types.js';

/**
 * Size and mtime of a non-note file the index knows. Metadata only, nothing is read: one `lstat`
 * of the indexed spelling (a full `VaultService.stat` resolves the real path of every file and
 * costs ~4× more on a vault with hundreds of attachments); anything that is not a plain file
 * there (a link, an NFD spelling, a file that vanished) goes through `VaultService.stat`.
 */
async function fileFacts(context: AppContext, path: VaultPath): Promise<FileFacts | null> {
  try {
    const info = await lstat(nodePath.join(context.vault.root, ...path.split('/')));
    if (info.isFile()) return { size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    // fall through to the vault service
  }
  return context.vault.stat(path).catch(() => null);
}

/** Notes from the index, other files from `fileFacts`; a path that vanished is left out. */
async function factsFor(
  context: AppContext,
  paths: VaultPath[],
): Promise<Map<VaultPath, FileFacts>> {
  const facts = new Map<VaultPath, FileFacts>();
  await Promise.all(
    paths.map(async (path) => {
      const note = context.index.getNote(path);
      const fact = note
        ? { size: note.size, mtimeMs: note.mtimeMs }
        : await fileFacts(context, path);
      if (fact) facts.set(path, fact);
    }),
  );
  return facts;
}

/**
 * Text state of the supported source files (SPEC F30.2), one after the other: a file the
 * background extraction has not seen yet is hashed here, and hashing many large files at once
 * would only compete for the disk. Nothing is extracted. No sources plugin → no entries.
 */
async function textsFor(
  context: AppContext,
  paths: VaultPath[],
): Promise<Map<VaultPath, ResourceText>> {
  const texts = new Map<VaultPath, ResourceText>();
  const sources = context.plugin<SourceTextService>(SOURCES_PLUGIN);
  if (!sources) return texts;
  for (const path of paths) {
    if (sourceFormatOf(path) === null) continue;
    const status = await sources.status(path).catch(() => null);
    if (status) {
      texts.set(path, {
        quality: status.quality,
        pages: status.pageCount,
        reason: status.reason ?? null,
      });
    }
  }
  return texts;
}

/** `GET /api/resources` → `{ files: ResourceFile[] }` for the "Tài liệu" view (SPEC F15, F30.2). */
export function registerResourcesRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/resources', async () => {
    await context.settled();
    const rows = context.index.graphRows();
    const paths = resourcePaths(rows);
    const facts = await factsFor(context, paths);
    const texts = await textsFor(
      context,
      paths.filter((path) => facts.has(path)),
    );
    return { files: buildResourceListing(rows, facts, texts) };
  });
}
