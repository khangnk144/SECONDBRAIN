import { useEffect, useRef, useState } from 'react';
import { getSearch } from '../../lib/api/search-api';
import { useTabsStore } from '../../lib/tabs-store';
import { mergeRecentNotes, toNoteHit, type NoteHit } from './recent-notes';

/** Wait after the last keystroke before asking the server (brief: 120 ms). */
export const SEARCH_DEBOUNCE_MS = 120;

export interface PaletteResults {
  /** The query the shown hits answer (lags behind the input while a request is pending). */
  answered: string | null;
  hits: NoteHit[];
  error: boolean;
}

/** Title matches first, keeping the server's order inside each group. */
function titleMatchesFirst(hits: NoteHit[]): NoteHit[] {
  return [
    ...hits.filter((hit) => hit.matchedIn === 'title'),
    ...hits.filter((hit) => hit.matchedIn !== 'title'),
  ];
}

async function fetchHits(query: string): Promise<NoteHit[]> {
  // The query goes out exactly as typed (NFD or NFC): the server folds it.
  const { results } = await getSearch({ q: query });
  if (query.trim() === '') return mergeRecentNotes(useTabsStore.getState().tabs, results);
  return titleMatchesFirst(results.map(toNoteHit));
}

/**
 * Results for the palette input: the first request goes out at once (the palette just opened),
 * later ones 120 ms after typing stops; answers to outdated queries are dropped. The previous
 * hits stay on screen until the next answer arrives.
 */
export function usePaletteResults(query: string): PaletteResults {
  const [state, setState] = useState<PaletteResults>({ answered: null, hits: [], error: false });
  const sequence = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    const run = async () => {
      const id = ++sequence.current;
      try {
        const hits = await fetchHits(query);
        if (id === sequence.current) setState({ answered: query, hits, error: false });
      } catch {
        if (id === sequence.current) setState({ answered: query, hits: [], error: true });
      }
    };
    if (first.current) {
      first.current = false;
      void run();
      return;
    }
    const handle = setTimeout(() => void run(), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  return state;
}
