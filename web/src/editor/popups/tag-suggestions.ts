import { create } from 'zustand';
import { getTags } from '../../lib/api/search-api';
import type { TagCount } from '../../lib/api/search-types';
import { foldText } from '../../lib/fold-text';
import { subscribeServerEvent } from '../../lib/ws/server-event-bus';

interface TagSuggestionsState {
  tags: TagCount[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** A note changed since the last fetch: fetch again the next time the popup opens. */
  stale: boolean;
  /** Fetches `GET /api/tags` unless a fresh answer is already there. */
  ensure: () => void;
}

let unsubscribe: (() => void) | null = null;

function watchNoteEvents(markStale: () => void) {
  if (unsubscribe) return;
  const offs = (
    ['note:changed', 'note:created', 'note:deleted', 'note:renamed', 'resync'] as const
  ).map((type) => subscribeServerEvent(type, markStale));
  unsubscribe = () => offs.forEach((off) => off());
}

/** Existing tags for the `#` popup (F6.1), refetched after note events. */
export const useTagSuggestions = create<TagSuggestionsState>((set, get) => ({
  tags: [],
  status: 'idle',
  stale: false,
  ensure: () => {
    watchNoteEvents(() => set({ stale: true }));
    const { status, stale } = get();
    if (status === 'loading' || (status === 'ready' && !stale)) return;
    set({ status: 'loading', stale: false });
    getTags().then(
      ({ tags }) => set({ tags, status: 'ready' }),
      () => set({ status: 'error' }),
    );
  },
}));

/** Test helper. */
export function resetTagSuggestions(): void {
  unsubscribe?.();
  unsubscribe = null;
  useTagSuggestions.setState({ tags: [], status: 'idle', stale: false });
}

const foldedCache = new WeakMap<object, { tag: TagCount; folded: string; segments: string[] }[]>();
const collator = new Intl.Collator('vi', { numeric: true });

/**
 * Tags matching what was typed after `#`, diacritics ignored (`do-an` → `đồ-án`): whole tag or
 * any `/` segment starting with it first, then tags containing it; more used tags first.
 */
export function rankTags(tags: readonly TagCount[], query: string, limit = 8): TagCount[] {
  let folded = foldedCache.get(tags);
  if (!folded) {
    folded = tags.map((tag) => {
      const value = foldText(tag.tag);
      return { tag, folded: value, segments: value.split('/') };
    });
    foldedCache.set(tags, folded);
  }
  const q = foldText(query);
  const scored: { tag: TagCount; score: number }[] = [];
  for (const entry of folded) {
    let score: number | null = null;
    if (q === '' || entry.folded.startsWith(q)) score = 0;
    else if (entry.segments.some((segment) => segment.startsWith(q))) score = 1;
    else if (entry.folded.includes(q)) score = 2;
    if (score !== null) scored.push({ tag: entry.tag, score });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score || b.tag.count - a.tag.count || collator.compare(a.tag.tag, b.tag.tag),
  );
  return scored.slice(0, limit).map((s) => s.tag);
}
