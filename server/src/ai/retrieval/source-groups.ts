/**
 * Groups the chosen chunks into citable sources: one `S<n>` per note, one per page of a PDF,
 * numbered in the order the ranking first reaches them; chunks inside a source keep the order of
 * the file. These are the only ids the model may cite.
 */
import { sourceBlock } from '../prompts/data-blocks.js';
import type { RetrievedChunk, RetrievedSource } from './retrieval-types.js';

export function groupSources(chunks: readonly RetrievedChunk[]): RetrievedSource[] {
  const groups = new Map<string, RetrievedSource>();
  for (const chunk of chunks) {
    const key = `${chunk.path}\u0000${chunk.page ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        id: `S${groups.size + 1}`,
        path: chunk.path,
        title: chunk.title,
        page: chunk.page,
        chunks: [],
      };
      groups.set(key, group);
    }
    group.chunks.push(chunk);
  }
  for (const group of groups.values()) group.chunks.sort((a, b) => a.startLine - b.startLine);
  return [...groups.values()];
}

/** The `<source>` blocks of the prompt (separate passages of one note are marked with `[…]`). */
export function sourceBlocks(sources: readonly RetrievedSource[]): string[] {
  return sources.map((source) =>
    sourceBlock(
      { id: source.id, path: source.path, title: source.title, page: source.page },
      source.chunks.map((chunk) => chunk.text).join('\n\n[…]\n\n'),
    ),
  );
}
