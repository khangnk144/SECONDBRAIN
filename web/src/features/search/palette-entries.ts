import type { VaultPath } from '../../lib/api/vault-types';
import type { AppCommand } from '../../lib/commands/command-registry';
import { createNote } from '../../lib/note-operations';
import { cleanName, validateName } from '../../lib/name-validation';
import { openVaultFile, vaultFileKind } from '../../lib/open-vault-file';
import { useTabsStore } from '../../lib/tabs-store';
import { samePath } from '../../lib/vault-paths';
import type { FilterSuggestion } from './filter-suggestions';
import { hasFilter } from './palette-query';
import type { NoteHit } from './recent-notes';
import type { PaletteResults } from './use-palette-results';
import type { SemanticHit } from './use-semantic-results';

/**
 * One row of the palette list. Rows are a tagged union so each source (notes, "Tạo", commands,
 * filter values) has its own renderer while the list and the keyboard stay shared.
 */
export type PaletteEntry =
  | { kind: 'note'; key: string; hit: NoteHit }
  | { kind: 'create'; key: string; title: string }
  | { kind: 'command'; key: string; command: AppCommand }
  | { kind: 'filter'; key: string; suggestion: FilterSuggestion }
  /** "Theo nghĩa": a hit of the search by meaning (hybrid retrieval only), listed last. */
  | { kind: 'semantic'; key: string; hit: SemanticHit };

export type PaletteMode = 'notes' | 'commands';

export interface PaletteView {
  mode: PaletteMode;
  entries: PaletteEntry[];
  /** The query is answered, not blank, and no note (or, in command mode, no command) matched. */
  noMatch: boolean;
  /** Showing recently opened notes for a blank query. */
  recent: boolean;
}

export interface PaletteExtras {
  mode: PaletteMode;
  /** Commands matching the query (command mode: all matches; else the few named by it). */
  commands: readonly AppCommand[];
  /** Values for the filter being typed, shown first. */
  suggestions: readonly FilterSuggestion[];
  /** Hits by meaning for this query (empty unless hybrid retrieval answered it). */
  semantic?: readonly SemanticHit[];
}

/** A query can become a note title only when it is a valid file name (no `tag:` filters…). */
export function creatableTitle(query: string): string | null {
  if (hasFilter(query)) return null;
  const title = cleanName(query);
  return validateName(title) === null ? title : null;
}

const commandEntry = (command: AppCommand): PaletteEntry => ({
  kind: 'command',
  key: `command:${command.id}`,
  command,
});

export function buildPaletteView(
  query: string,
  results: PaletteResults,
  extras: PaletteExtras,
): PaletteView {
  if (extras.mode === 'commands') {
    const entries = extras.commands.map(commandEntry);
    return { mode: 'commands', entries, noMatch: entries.length === 0, recent: false };
  }
  const answered = results.answered === query;
  const blank = query.trim() === '';
  const entries: PaletteEntry[] = extras.suggestions.map((suggestion) => ({
    kind: 'filter',
    key: `filter:${suggestion.key}:${suggestion.value}`,
    suggestion,
  }));
  for (const hit of results.hits) entries.push({ kind: 'note', key: `note:${hit.path}`, hit });
  const noMatch = answered && !results.error && !blank && results.hits.length === 0;
  // "Tạo" is offered whenever no result already has exactly this title (design.md §7: searching
  // for "ma trận" may find unrelated notes and should still offer to create it).
  const titleKey = (text: string) => text.trim().normalize('NFC').toLowerCase();
  const exists = results.hits.some((hit) => titleKey(hit.title) === titleKey(query));
  const offerCreate = answered && !results.error && !blank && !exists;
  const title = offerCreate ? creatableTitle(query) : null;
  if (title !== null) entries.push({ kind: 'create', key: `create:${title}`, title });
  entries.push(...extras.commands.map(commandEntry));
  // Last, so rows already under the keyboard never move when these arrive; files the keyword
  // search already lists are not repeated.
  for (const hit of extras.semantic ?? []) {
    if (results.hits.some((note) => samePath(note.path, hit.path))) continue;
    entries.push({ kind: 'semantic', key: `semantic:${hit.path}`, hit });
  }
  return { mode: 'notes', entries, noMatch, recent: blank && results.answered?.trim() === '' };
}

/** A hit opens as a note, or (a PDF page) in the viewer at that page. */
function openHit(path: VaultPath, page: number | null | undefined, newTab: boolean): void {
  if (vaultFileKind(path) === 'note') useTabsStore.getState().openNote(path, { newTab });
  else openVaultFile(path, { newTab, ...(typeof page === 'number' ? { page } : {}) });
}

/**
 * Runs a row: opens the note or the PDF at its page (`newTab` for Ctrl+Enter / Ctrl+click),
 * creates it in Inbox, or runs the command. Filter rows complete the query instead (the dialog
 * handles them).
 */
export function runPaletteEntry(entry: PaletteEntry, newTab: boolean): void {
  switch (entry.kind) {
    case 'note':
      openHit(entry.hit.path, entry.hit.page, newTab);
      return;
    case 'semantic':
      openHit(entry.hit.path, entry.hit.page, newTab);
      return;
    case 'create':
      void createNote({ title: entry.title, newTab });
      return;
    case 'command':
      // After the palette has closed and focus is back where it was: a command that remembers
      // focus (quick capture) or opens another overlay must not start from the palette input.
      setTimeout(() => entry.command.run(), 0);
      return;
    case 'filter':
      return;
  }
}
