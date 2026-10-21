/** Shapes of the retrieval step of text questions, editor actions and semantic search (F33). */
import type { IndexService } from '../../index/index-types.js';
import type { VaultPath } from '../../vault/vault-types.js';

/** One retrieval unit sent to the model: a chunk of a note, or of one page of a source. */
export interface RetrievedChunk {
  /** Identity for fusion: `<path>#<chunk index>` for notes, `<path>#p<page>:<line>` for pages. */
  key: string;
  path: VaultPath;
  /** Note title, or the source's title (file name without extension for most files). */
  title: string;
  /** PDF page, null for notes. */
  page: number | null;
  heading: string | null;
  startLine: number;
  endLine: number;
  text: string;
}

/** Chunks of one note (or one source page), cited as one `[S<n>]`. */
export interface RetrievedSource {
  id: string;
  path: VaultPath;
  title: string;
  page: number | null;
  chunks: RetrievedChunk[];
}

export interface RetrievalResult {
  /** `hybrid` when an embedding query ran and was fused in. */
  mode: 'bm25' | 'hybrid';
  /** The chosen chunks, best first (current-note chunks lead). */
  chunks: RetrievedChunk[];
  /** Matching notes and sources left out because they are outside the AI scope. */
  hidden: number;
  /**
   * Of those, the ones that are not raw sources (`3 Resources`, out of the default scope, so a
   * match there is expected, not news): notes in a folder left out of the scope.
   */
  hiddenNotes: number;
}

/** What `retrieveChunks` needs from the index (OR-BM25 candidates and titles). */
export type RetrievalIndex = Pick<IndexService, 'retrieve' | 'getNote'>;
