import type { MouseEvent } from 'react';
import { withQuery } from '../../lib/api/query-string';
import type { VaultPath } from '../../lib/api/vault-types';
import { navigateTo, NOTE_ROUTE } from '../../lib/app-navigation';
import { useTabsStore } from '../../lib/tabs-store';

/** `/note?path=…&line=N`: `line` is 1-based in the file (front matter included), as the server counts. */
export function noteLineRoute(path: VaultPath, line: number): string {
  return withQuery(NOTE_ROUTE, { path, line });
}

/** Opens a note at a line, in the current tab or (`newTab`) beside it. */
export function openNoteAtLine(path: VaultPath, line: number, options: { newTab?: boolean } = {}) {
  useTabsStore.getState().openNote(path, { newTab: options.newTab === true });
  // `openNote` navigated to the note itself; replacing that entry adds the line without a second
  // history step.
  navigateTo(noteLineRoute(path, line), { replace: true });
}

/** Moves within the note on screen (outline): same tab, no extra history entry. */
export function jumpToLine(path: VaultPath, line: number) {
  navigateTo(noteLineRoute(path, line), { replace: true });
}

/** Ctrl/⌘ + click and middle click open in a new tab (SPEC F23). */
export function wantsNewTab(event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'button'>): boolean {
  return event.ctrlKey || event.metaKey || event.button === 1;
}

/** Click handlers for a row that opens a note: plain, Ctrl+click and middle click. */
export function noteLinkHandlers(open: (newTab: boolean) => void) {
  return {
    onClick: (event: MouseEvent) => open(wantsNewTab(event)),
    onAuxClick: (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      open(true);
    },
    // A middle press would otherwise start the browser's autoscroll.
    onMouseDown: (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    },
  };
}
