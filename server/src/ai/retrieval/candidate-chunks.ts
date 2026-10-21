/**
 * Reads the candidate files the index found and cuts them into chunks with the one chunker
 * (`note-chunks.ts`): notes through the vault service, other sources (PDF pages near the hit,
 * `.html`, `.txt`) through the source-text service. A file that vanished or cannot be read is
 * skipped; retrieval never fails because of one file.
 */
import { isNotePath, noteTitleFromPath } from '../../markdown/content-classes.js';
import type { SourceTextService } from '../../sources/source-types.js';
import type { VaultPath, VaultService } from '../../vault/vault-types.js';
import { chunkMarkdown, chunkPages } from '../note-chunks.js';
import type { RetrievalHit } from '../../index/index-types.js';
import type { RetrievedChunk } from './retrieval-types.js';

export interface ChunkReaders {
  vault: Pick<VaultService, 'read'>;
  sources: Pick<SourceTextService, 'read'> | null;
}

/** Pages read around each hit page (the hit's neighbours often hold the rest of the passage). */
const PAGE_MARGIN = 1;

export async function noteChunks(
  readers: ChunkReaders,
  path: VaultPath,
  title: string,
): Promise<RetrievedChunk[]> {
  try {
    const note = await readers.vault.read(path);
    // A lossy decode would send replacement characters as if they were her words.
    if (!note.utf8) return [];
    return chunkMarkdown(note.content).map((chunk) => ({
      key: `${path}#${chunk.index}`,
      path,
      title,
      page: null,
      heading: chunk.heading,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text,
    }));
  } catch {
    return [];
  }
}

/** Merged inclusive page ranges around the hit pages (all pages when no page is known). */
function pageRanges(pages: readonly (number | null)[]): { fromPage?: number; toPage?: number }[] {
  const known = [...new Set(pages.filter((p): p is number => p !== null))].sort((a, b) => a - b);
  if (known.length === 0) return [{}];
  const ranges: { fromPage: number; toPage: number }[] = [];
  for (const page of known) {
    const from = Math.max(1, page - PAGE_MARGIN);
    const last = ranges.at(-1);
    if (last && from <= last.toPage + 1) last.toPage = page + PAGE_MARGIN;
    else ranges.push({ fromPage: from, toPage: page + PAGE_MARGIN });
  }
  return ranges;
}

async function sourceChunks(
  readers: ChunkReaders,
  path: VaultPath,
  title: string,
  pages: readonly (number | null)[],
): Promise<RetrievedChunk[]> {
  if (!readers.sources) return [];
  const out: RetrievedChunk[] = [];
  for (const range of pageRanges(pages)) {
    try {
      const text = await readers.sources.read(path, range);
      if (text.extractionQuality === 'none') continue;
      for (const chunk of chunkPages(text.pages)) {
        out.push({
          key: `${path}#p${chunk.page}:${chunk.startLine}`,
          path,
          title,
          page: chunk.page ?? null,
          heading: null,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          text: chunk.text,
        });
      }
    } catch {
      // Unreadable or deleted since it was indexed: skip it.
    }
  }
  return out;
}

/** Chunks of every candidate (hits already filtered to the AI scope), in hit order. */
export async function candidateChunks(
  readers: ChunkReaders,
  hits: readonly RetrievalHit[],
): Promise<RetrievedChunk[]> {
  const byPath = new Map<VaultPath, { title: string; pages: (number | null)[] }>();
  for (const hit of hits) {
    const entry = byPath.get(hit.path) ?? {
      title: hit.title || noteTitleFromPath(hit.path),
      pages: [],
    };
    entry.pages.push(hit.page);
    byPath.set(hit.path, entry);
  }
  const lists = await Promise.all(
    [...byPath].map(([path, { title, pages }]) =>
      isNotePath(path)
        ? noteChunks(readers, path, title)
        : sourceChunks(readers, path, title, pages),
    ),
  );
  return lists.flat();
}
