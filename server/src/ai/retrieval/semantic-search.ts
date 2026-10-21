/**
 * `POST /api/ai/search` (SPEC F33.3, the palette's meaning search): the retrieval pipeline of the
 * chat, one result per note (or PDF page), in scope only. Hybrid when embeddings are available,
 * else BM25 retrieval alone – then nothing leaves the machine. Embedding neighbours count only
 * from `MIN_VECTOR_SCORE` on (every note has *some* nearest neighbour); snippets are plain text.
 */
import { isNotePath } from '../../markdown/content-classes.js';
import { foldWithMap } from '../../markdown/normalize-text.js';
import { parseNote } from '../../markdown/parse-note.js';
import type { VaultPath } from '../../vault/vault-types.js';
import { queryTerms } from './chunk-bm25.js';
import { retrieveChunks, type RetrieveOptions } from './retrieve-chunks.js';

/**
 * Cosine similarity a vector hit needs to be listed in "Theo nghĩa". With the default model
 * (text-embedding-3-small) unrelated short texts mostly score below 0.2 and related ones above
 * 0.3, so 0.25 drops "nothing in common" notes while a loose paraphrase stays; a model with a
 * higher baseline (Gemini) lets more through, never fewer. BM25 hits (shared words) are listed
 * whatever their vector score. Chat retrieval keeps every neighbour (the model reads them).
 */
export const MIN_VECTOR_SCORE = 0.25;

export interface SemanticResult {
  path: VaultPath;
  title: string;
  snippet: string;
  page: number | null;
  /** 1 for the best result, then 1/2, 1/3…: only the order is meaningful. */
  score: number;
}

const SNIPPET_CHARS = 200;
const LEAD_CHARS = 60;

/**
 * A note chunk as the words she reads: no heading `#`, emphasis, list/task markers or code ticks;
 * `[[a|b]]` → `b`, `[[a]]` → `a` (the index's own plain text). PDF and other source text is
 * already plain.
 */
export function plainChunkText(path: VaultPath, text: string): string {
  if (!isNotePath(path)) return text;
  const plain = parseNote(text).plainText;
  return plain.trim() === '' ? text : plain;
}

/** About 200 characters of the chunk around the first query term (original diacritics). */
export function snippetOf(text: string, terms: readonly string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const { folded, map } = foldWithMap(flat);
  const hits = terms.map((term) => folded.indexOf(term)).filter((i) => i >= 0);
  const at = hits.length > 0 ? map[Math.min(...hits)]! : 0;
  const start = Math.max(0, at - LEAD_CHARS);
  const piece = flat.slice(start, start + SNIPPET_CHARS);
  return `${start > 0 ? '…' : ''}${piece}${start + SNIPPET_CHARS < flat.length ? '…' : ''}`;
}

export async function semanticSearch(
  q: string,
  limit: number,
  options: Omit<RetrieveOptions, 'chunkLimit' | 'charLimit' | 'notePath'>,
): Promise<{ mode: 'bm25' | 'hybrid'; results: SemanticResult[] }> {
  const retrieval = await retrieveChunks(q, {
    ...options,
    chunkLimit: 60,
    charLimit: Number.POSITIVE_INFINITY,
    minVectorScore: MIN_VECTOR_SCORE,
  });
  const terms = queryTerms(q);
  const results: SemanticResult[] = [];
  const seen = new Set<string>();
  for (const chunk of retrieval.chunks) {
    const key = `${chunk.path}\u0000${chunk.page ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      path: chunk.path,
      title: chunk.title,
      snippet: snippetOf(plainChunkText(chunk.path, chunk.text), terms),
      page: chunk.page,
      score: 1 / (results.length + 1),
    });
    if (results.length === limit) break;
  }
  return { mode: retrieval.mode, results };
}
