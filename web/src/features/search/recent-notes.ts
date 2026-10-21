import type { SearchResult } from '../../lib/api/search-types';
import type { VaultPath } from '../../lib/api/vault-types';
import type { NoteTab } from '../../lib/tabs-store';
import { noteTitleFromPath, samePath } from '../../lib/vault-paths';

/** SPEC F8: an empty query shows this many recently opened notes. */
export const RECENT_NOTES_LIMIT = 8;

/** A note row of the palette (search hit or recent note). */
export interface NoteHit {
  path: VaultPath;
  title: string;
  snippet: SearchResult['snippet'];
  matchedIn: SearchResult['matchedIn'];
}

export const toNoteHit = (result: SearchResult): NoteHit => ({
  path: result.path,
  title: result.title,
  snippet: result.snippet,
  matchedIn: result.matchedIn,
});

/** A recently opened note (from the per-vault history) as a palette row. */
export const recentHit = (path: VaultPath): NoteHit => ({
  path,
  title: noteTitleFromPath(path),
  snippet: null,
  matchedIn: 'recent',
});

/**
 * Fallback while the history of opened notes is still empty (first run, new vault): the open tabs
 * by last activation, then the server's recently modified notes up to the limit, without repeats.
 */
export function mergeRecentNotes(
  tabs: readonly NoteTab[],
  serverRecents: readonly SearchResult[],
  limit = RECENT_NOTES_LIMIT,
): NoteHit[] {
  const hits: NoteHit[] = [...tabs]
    .sort((a, b) => b.lastActive - a.lastActive)
    .map((tab) => recentHit(tab.path));
  for (const result of serverRecents) hits.push(toNoteHit(result));
  const unique: NoteHit[] = [];
  for (const hit of hits) {
    if (!unique.some((seen) => samePath(seen.path, hit.path))) unique.push(hit);
    if (unique.length === limit) break;
  }
  return unique;
}
