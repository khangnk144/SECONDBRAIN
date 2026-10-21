import { useEffect, useState } from 'react';
import type { AiSearchResult } from '../../lib/api/ai-types';
import { semanticSearch } from '../../lib/api/ai-api';
import type { VaultPath } from '../../lib/api/vault-types';
import { samePath } from '../../lib/vault-paths';

/** "Theo nghĩa" asks the server only after typing pauses this long (each search may cost tokens). */
export const SEMANTIC_DEBOUNCE_MS = 400;
/** …and only for queries of at least this many characters. */
export const SEMANTIC_MIN_CHARS = 3;
export const SEMANTIC_LIMIT = 8;

/** A row of the "Theo nghĩa" section. */
export interface SemanticHit {
  path: VaultPath;
  title: string;
  /** Plain excerpt (no highlight ranges: matches are by meaning). */
  snippet: string | null;
  page: number | null;
}

export interface SemanticResults {
  /** The query these hits answer. */
  answered: string | null;
  hits: SemanticHit[];
}

const NONE: SemanticResults = { answered: null, hits: [] };

/** One row per file, best first (the server may return several pages of one PDF). */
export function toSemanticHits(results: readonly AiSearchResult[]): SemanticHit[] {
  const hits: SemanticHit[] = [];
  for (const result of results) {
    if (hits.some((hit) => samePath(hit.path, result.path))) continue;
    hits.push({
      path: result.path,
      title: result.title,
      snippet: result.snippet || null,
      page: typeof result.page === 'number' ? result.page : null,
    });
  }
  return hits;
}

/** Whether `query` may be sent for a search by meaning. */
export function meaningSearchable(query: string): boolean {
  return Array.from(query.trim()).length >= SEMANTIC_MIN_CHARS;
}

/**
 * `POST /ai/search` for the palette (SPEC F33.3), only while `enabled` (hybrid retrieval and AI
 * ready) and for queries of 3+ characters, 400 ms after typing stops. A change aborts the request
 * (an answer still on its way is dropped); the previous hits stay on screen until the
 * next answer, like the keyword results. Failures show nothing (the keyword results are there).
 */
export function useSemanticResults(query: string, enabled: boolean): SemanticResults {
  const [state, setState] = useState<SemanticResults>(NONE);
  const active = enabled && meaningSearchable(query);
  const text = query.trim();

  useEffect(() => {
    if (!active) {
      // Never show hits of an earlier query once the section went away.
      setState((current) => (current === NONE ? current : NONE));
      return;
    }
    // A change aborts the request already sent (the server stops its embedding call) and drops
    // any answer still on its way.
    let cancelled = false;
    const controller = new AbortController();
    const handle = setTimeout(() => {
      semanticSearch(text, SEMANTIC_LIMIT, controller.signal).then(
        (response) => {
          if (!cancelled) setState({ answered: text, hits: toSemanticHits(response.results) });
        },
        () => {
          if (!cancelled) setState({ answered: text, hits: [] });
        },
      );
    }, SEMANTIC_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
      controller.abort();
    };
  }, [active, text]);

  return active ? state : NONE;
}
