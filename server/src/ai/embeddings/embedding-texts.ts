/**
 * What is embedded for a chunk: the note title (and the chunk's heading) above the chunk text, so
 * a question about a topic finds notes whose title names it. The hash of exactly that text decides
 * whether a stored vector can be reused.
 */
import { createHash } from 'node:crypto';
import { noteTitleFromPath } from '../../markdown/content-classes.js';
import type { VaultPath } from '../../vault/vault-types.js';
import type { NoteChunk } from '../ai-types.js';
import { chunkMarkdown } from '../note-chunks.js';

export interface PreparedChunk {
  chunk: NoteChunk;
  embedText: string;
  hash: string;
}

export function embedTextOf(title: string, chunk: NoteChunk): string {
  const header = chunk.heading && chunk.heading !== title ? `${title} – ${chunk.heading}` : title;
  return `${header}\n\n${chunk.text}`;
}

export function textHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Chunks of a note's content with their embedding texts and hashes. */
export function prepareChunks(notePath: VaultPath, content: string): PreparedChunk[] {
  const title = noteTitleFromPath(notePath);
  return chunkMarkdown(content).map((chunk) => {
    const embedText = embedTextOf(title, chunk);
    return { chunk, embedText, hash: textHash(embedText) };
  });
}
