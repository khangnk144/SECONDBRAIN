/**
 * One embedding pass: everything queued (and whatever is queued meanwhile) is read, chunked and
 * embedded in requests of at most 64 texts; unchanged chunks keep their vectors. A first read
 * counts the texts to embed, so progress has a real total. On failure the unfinished notes go
 * back to the queue and the error propagates (the service decides about retries).
 */
import { isNotePath } from '../../markdown/content-classes.js';
import { isVaultError, type VaultPath } from '../../vault/vault-types.js';
import { providerError } from '../providers/provider-http.js';
import { vectorToBlob } from '../providers/vector-math.js';
import { embedTexts, type EmbeddingDeps } from './embedding-deps.js';
import type { EmbeddingStore } from './embedding-store.js';
import { prepareChunks, type PreparedChunk } from './embedding-texts.js';

export const EMBED_BATCH_SIZE = 64;

export interface PassHost {
  deps: EmbeddingDeps;
  store: EmbeddingStore;
  queue: Set<VaultPath>;
  signal: AbortSignal;
  progress: { done: number; total: number };
  /** Deleted or renamed away during the pass: never written. */
  dropped: Set<VaultPath>;
  isActive(): boolean;
  onProgress(): void;
}

interface PreparedNote {
  path: VaultPath;
  revision: string;
  chunks: PreparedChunk[];
  /** Indexes of `chunks` without a stored vector. */
  need: number[];
}

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw providerError('aborted');
}

/** The note's chunks and what must be embedded; null when nothing is to do (rows cleaned up). */
async function prepareNote(host: PassHost, path: VaultPath): Promise<PreparedNote | null> {
  checkAborted(host.signal);
  if (!isNotePath(path) || !host.deps.inScope(path)) {
    host.store.removeNote(path);
    return null;
  }
  let note;
  try {
    note = await host.deps.context.vault.read(path);
  } catch (error) {
    checkAborted(host.signal);
    if (!isVaultError(error) || error.code !== 'NOT_FOUND') throw error;
    host.store.removeNote(path);
    return null;
  }
  checkAborted(host.signal);
  if (host.store.revisionOf(path) === note.revision) return null;
  const chunks = prepareChunks(path, note.content);
  const known = host.store.hashesOf(path);
  const need = chunks.flatMap((chunk, i) => (known.has(chunk.hash) ? [] : [i]));
  return { path, revision: note.revision, chunks, need };
}

async function flush(host: PassHost, batch: PreparedNote[], remaining: Set<VaultPath>) {
  const texts = batch.flatMap((note) => note.need.map((i) => note.chunks[i]!.embedText));
  const vectors: Float32Array[] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const slice = texts.slice(start, start + EMBED_BATCH_SIZE);
    vectors.push(...(await embedTexts(host.deps, slice, host.signal)));
    checkAborted(host.signal); // a model change or switch-off: never write old vectors
    host.progress.done += slice.length;
    host.onProgress();
  }
  const embeddedAt = host.deps.now().toISOString();
  let offset = 0;
  for (const note of batch) {
    const fresh = new Map<number, Float32Array>();
    for (const i of note.need) fresh.set(i, vectors[offset++]!);
    remaining.delete(note.path);
    if (host.dropped.has(note.path) || !host.deps.inScope(note.path)) continue;
    host.store.writeNote(
      note.path,
      note.revision,
      note.chunks.map(({ chunk, hash }, i) => {
        const vector = fresh.get(i);
        return {
          idx: chunk.index,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          heading: chunk.heading,
          textHash: hash,
          vector: vector ? vectorToBlob(vector) : null,
        };
      }),
      embeddedAt,
    );
  }
}

async function embedRound(host: PassHost, round: VaultPath[], remaining: Set<VaultPath>) {
  const counted = new Map<VaultPath, number>();
  for (const path of round) {
    const prepared = await prepareNote(host, path);
    if (!prepared) {
      remaining.delete(path);
      continue;
    }
    counted.set(path, prepared.need.length);
    host.progress.total += prepared.need.length;
  }
  host.onProgress();
  let batch: PreparedNote[] = [];
  let size = 0;
  for (const [path, need] of counted) {
    const prepared = await prepareNote(host, path);
    host.progress.total += (prepared?.need.length ?? 0) - need; // changed since it was counted
    if (!prepared) {
      remaining.delete(path);
      continue;
    }
    if (size > 0 && size + prepared.need.length > EMBED_BATCH_SIZE) {
      await flush(host, batch, remaining);
      batch = [];
      size = 0;
    }
    batch.push(prepared);
    size += prepared.need.length;
  }
  if (batch.length > 0) await flush(host, batch, remaining);
}

export async function runEmbeddingPass(host: PassHost): Promise<void> {
  while (host.queue.size > 0) {
    if (!host.isActive()) return; // paused or switched off: the paths stay queued
    const round = [...host.queue];
    host.queue.clear();
    const remaining = new Set(round);
    try {
      await embedRound(host, round, remaining);
    } catch (error) {
      for (const path of remaining) host.queue.add(path);
      throw error;
    }
  }
}
