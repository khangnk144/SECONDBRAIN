import { createNote } from '../../lib/note-operations';
import { cleanName, validateName } from '../../lib/name-validation';
import { useTabsStore } from '../../lib/tabs-store';
import type { NoteHit } from './recent-notes';
import type { PaletteResults } from './use-palette-results';

/**
 * One row of the palette list. Rows are a tagged union so another source (the `>` command mode
 * planned for later) can add its own kind and renderer without touching the list or keyboard.
 */
export type PaletteEntry =
  { kind: 'note'; key: string; hit: NoteHit } | { kind: 'create'; key: string; title: string };

export interface PaletteView {
  entries: PaletteEntry[];
  /** The query is answered, not blank, and nothing matched. */
  noMatch: boolean;
  /** Showing recently opened notes for a blank query. */
  recent: boolean;
}

/** A query can become a note title only when it is a valid file name (no `tag:` filters…). */
export function creatableTitle(query: string): string | null {
  const title = cleanName(query);
  return validateName(title) === null ? title : null;
}

export function buildPaletteView(query: string, results: PaletteResults): PaletteView {
  const answered = results.answered === query;
  const blank = query.trim() === '';
  const entries: PaletteEntry[] = results.hits.map((hit) => ({
    kind: 'note',
    key: `note:${hit.path}`,
    hit,
  }));
  const noMatch = answered && !results.error && !blank && entries.length === 0;
  // "Tạo" is offered whenever no result already has exactly this title (design.md §7: searching
  // for "ma trận" may find unrelated notes and should still offer to create it).
  const titleKey = (text: string) => text.trim().normalize('NFC').toLowerCase();
  const exists = results.hits.some((hit) => titleKey(hit.title) === titleKey(query));
  const offerCreate = answered && !results.error && !blank && !exists;
  const title = offerCreate ? creatableTitle(query) : null;
  if (title !== null) entries.push({ kind: 'create', key: `create:${title}`, title });
  return { entries, noMatch, recent: blank && results.answered?.trim() === '' };
}

/** Runs a row: opens the note (`newTab` for Ctrl+Enter / Ctrl+click) or creates it in Inbox. */
export function runPaletteEntry(entry: PaletteEntry, newTab: boolean): void {
  switch (entry.kind) {
    case 'note':
      useTabsStore.getState().openNote(entry.hit.path, { newTab });
      return;
    case 'create':
      void createNote({ title: entry.title, newTab });
      return;
  }
}
