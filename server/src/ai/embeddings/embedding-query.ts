/**
 * `EmbeddingIndex.query` (SPEC F33 retrieval): embeds the question, scores every stored chunk of
 * an in-scope note by cosine similarity (unit vectors: a dot product) while streaming the rows,
 * keeps the top k, then re-reads those notes so each hit carries the note's current text and
 * lines. A hit whose text changed since it was embedded is dropped rather than misquoted.
 */
import type { VaultPath } from '../../vault/vault-types.js';
import type { EmbeddingHit } from '../ai-types.js';
import { dotBlob } from '../providers/vector-math.js';
import { embedTexts, type EmbeddingDeps } from './embedding-deps.js';
import type { EmbeddingStore } from './embedding-store.js';
import { prepareChunks } from './embedding-texts.js';
import { TopK } from './top-k.js';

export const MAX_QUERY_K = 200;

interface Candidate {
  path: VaultPath;
  idx: number;
  hash: string;
}

export async function queryEmbeddings(
  deps: EmbeddingDeps,
  store: EmbeddingStore,
  text: string,
  k: number,
  signal?: AbortSignal,
): Promise<EmbeddingHit[]> {
  const limit = Math.max(1, Math.min(MAX_QUERY_K, Math.floor(k)));
  const [query] = await embedTexts(deps, [text], signal);
  if (!query) return [];
  const scope = new Map<VaultPath, boolean>();
  const allowed = (path: VaultPath): boolean => {
    let value = scope.get(path);
    if (value === undefined) {
      value = deps.inScope(path);
      scope.set(path, value);
    }
    return value;
  };
  const top = new TopK<Candidate>(limit);
  for (const row of store.iterateChunks()) {
    if (!allowed(row.path)) continue;
    top.push(dotBlob(query, row.vector), { path: row.path, idx: row.idx, hash: row.text_hash });
  }

  const byPath = new Map<VaultPath, { score: number; item: Candidate }[]>();
  for (const entry of top.sorted()) {
    const list = byPath.get(entry.item.path) ?? [];
    list.push(entry);
    byPath.set(entry.item.path, list);
  }
  const hits: EmbeddingHit[] = [];
  for (const [path, entries] of byPath) {
    let content: string;
    try {
      content = (await deps.context.vault.read(path)).content;
    } catch {
      continue; // deleted meanwhile: its rows go with the delete event
    }
    const chunks = prepareChunks(path, content);
    for (const { score, item } of entries) {
      const same = chunks[item.idx];
      const match = same?.hash === item.hash ? same : chunks.find((c) => c.hash === item.hash);
      if (match) hits.push({ path, chunk: match.chunk, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}
