/**
 * Retrieval for text questions, editor actions and semantic search (SPEC F33 "Retrieval"):
 * 1. the index's OR-BM25 finds up to 40 candidate notes/PDF pages, kept only when in scope (and
 *    not a control doc);
 * 2. their chunks are ranked with BM25 over the folded question terms;
 * 3. with embeddings on, the 24 nearest chunks are ranked too (re-checked against the scope);
 * 4. both rankings are fused (RRF, k = 60) → at most 12 chunks and 24,000 characters (whole
 *    chunks; the tail is cut). The current note leads with up to its first 3 chunks.
 */
import { classifyPath, noteTitleFromPath } from '../../markdown/content-classes.js';
import type { VaultPath } from '../../vault/vault-types.js';
import { AiError, type AiRuntime } from '../ai-types.js';
import { candidateChunks, noteChunks, type ChunkReaders } from './candidate-chunks.js';
import { queryTerms, rankBm25 } from './chunk-bm25.js';
import { reciprocalRankFusion } from './rank-fusion.js';
import type { RetrievalIndex, RetrievalResult, RetrievedChunk } from './retrieval-types.js';

export const CANDIDATE_LIMIT = 40;
export const EMBEDDING_LIMIT = 24;
export const CHUNK_LIMIT = 12;
export const CHAR_LIMIT = 24_000;
export const CURRENT_NOTE_CHUNKS = 3;

export interface RetrieveOptions extends ChunkReaders {
  index: RetrievalIndex;
  runtime: Pick<AiRuntime, 'inScope' | 'embeddings'>;
  /** The note open in the editor ("ghi chú này" questions); used only when in scope. */
  notePath?: VaultPath | null;
  /** Paths never returned (an editor action's own note). */
  exclude?: ReadonlySet<VaultPath>;
  signal?: AbortSignal;
  chunkLimit?: number;
  charLimit?: number;
  /** Embedding neighbours below this cosine similarity are dropped (default: none dropped). */
  minVectorScore?: number;
}

const titleOf = (index: RetrievalIndex, path: VaultPath) =>
  index.getNote(path)?.title ?? noteTitleFromPath(path);

/** Embedding neighbours in scope; a provider failure falls back to BM25 alone (null). */
async function embeddingChunks(
  question: string,
  options: RetrieveOptions,
): Promise<RetrievedChunk[] | null> {
  const embeddings = options.runtime.embeddings();
  if (!embeddings) return null;
  try {
    const hits = await embeddings.query(question, EMBEDDING_LIMIT, options.signal);
    const floor = options.minVectorScore ?? Number.NEGATIVE_INFINITY;
    return hits
      .filter(
        (hit) =>
          hit.score >= floor &&
          options.runtime.inScope(hit.path) &&
          classifyPath(hit.path) !== 'control' &&
          !options.exclude?.has(hit.path),
      )
      .map((hit) => ({
        key: `${hit.path}#${hit.chunk.index}`,
        path: hit.path,
        title: titleOf(options.index, hit.path),
        page: hit.chunk.page ?? null,
        heading: hit.chunk.heading,
        startLine: hit.chunk.startLine,
        endLine: hit.chunk.endLine,
        text: hit.chunk.text,
      }));
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof AiError && error.code === 'AI_PROVIDER_ERROR') return null;
    throw error;
  }
}

/** Whole chunks in order until either limit is reached. */
function takeWithinLimits(chunks: RetrievedChunk[], count: number, chars: number) {
  const out: RetrievedChunk[] = [];
  let total = 0;
  for (const chunk of chunks) {
    if (out.length === count || total + chunk.text.length > chars) break;
    out.push(chunk);
    total += chunk.text.length;
  }
  return out;
}

export async function retrieveChunks(
  question: string,
  options: RetrieveOptions,
): Promise<RetrievalResult> {
  const { index, runtime } = options;
  // Control docs (CLAUDE.md, wiki index and log) are the app's and the wiki maintainer's
  // instructions and catalogs, not her knowledge: never a source.
  const hits = index
    .retrieve({ text: question, limit: CANDIDATE_LIMIT, includePdf: true })
    .filter((hit) => hit.class !== 'control');
  const inScope = hits.filter((hit) => runtime.inScope(hit.path));
  const left = hits.filter((hit) => !runtime.inScope(hit.path));
  const hidden = new Set(left.map((hit) => hit.path)).size;
  const hiddenNotes = new Set(left.filter((h) => h.class !== 'source').map((h) => h.path)).size;
  const candidates = inScope.filter((hit) => !options.exclude?.has(hit.path));
  const pool = await candidateChunks(options, candidates);
  // The title counts as part of every chunk: a question naming a note finds its passages.
  const bm25 = rankBm25(
    pool,
    (c) => `${c.title} ${c.heading ?? ''} ${c.text}`,
    queryTerms(question),
  );
  const embedded = await embeddingChunks(question, options);
  const fresh = new Map(pool.map((chunk) => [chunk.key, chunk]));
  const lists = [bm25.map((entry) => entry.item)];
  // Same key in both rankings: the text just read from disk wins over the stored one.
  if (embedded) lists.push(embedded.map((chunk) => fresh.get(chunk.key) ?? chunk));
  let ranked = reciprocalRankFusion(lists, (chunk) => chunk.key);

  const notePath = options.notePath ?? null;
  if (notePath && runtime.inScope(notePath) && !options.exclude?.has(notePath)) {
    const lead = (await noteChunks(options, notePath, titleOf(index, notePath))).slice(
      0,
      CURRENT_NOTE_CHUNKS,
    );
    const leadKeys = new Set(lead.map((chunk) => chunk.key));
    ranked = [...lead, ...ranked.filter((chunk) => !leadKeys.has(chunk.key))];
  }
  return {
    mode: embedded ? 'hybrid' : 'bm25',
    chunks: takeWithinLimits(
      ranked,
      options.chunkLimit ?? CHUNK_LIMIT,
      options.charLimit ?? CHAR_LIMIT,
    ),
    hidden,
    hiddenNotes,
  };
}
