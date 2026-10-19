import type { VaultPath } from '../lib/api/vault-types';

/** Where the "Chọn đích…" menu of an ambiguous link should open, and what it rewrites. */
export interface TargetMenuRequest {
  /** Document position of the wikilink node. */
  pos: number;
  /** Its target when the menu opened (the rewrite is skipped if the link changed meanwhile). */
  target: string;
  candidates: VaultPath[];
  /** Viewport coordinates for the menu's top-left corner. */
  x: number;
  y: number;
  /** Element that gets focus back when the menu closes. */
  returnFocus: HTMLElement | null;
}

/** Handles a key while a popup is open; returns true when the key was used. */
export type PopupKeyHandler = (event: KeyboardEvent) => boolean;

/**
 * Mutable, per-editor bridge between ProseMirror plugins/node views (plain objects created once)
 * and the React component that owns the editor (props that change over time, popups).
 */
export interface EditorContext {
  getNotePath: () => VaultPath;
  setNotePath: (path: VaultPath) => void;
  /** Called when the note path changes (links re-resolve relative to the new folder). */
  subscribe: (listener: () => void) => () => void;
  /** Opens the target menu of an ambiguous link; installed by the editor component. */
  openTargetMenu: (request: TargetMenuRequest) => void;
  /** Key handler of the popup that is currently shown (null when none). */
  popupKeyHandler: PopupKeyHandler | null;
}

export function createEditorContext(notePath: VaultPath): EditorContext {
  let current = notePath;
  const listeners = new Set<() => void>();
  return {
    getNotePath: () => current,
    setNotePath: (path) => {
      if (path === current) return;
      current = path;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openTargetMenu: () => undefined,
    popupKeyHandler: null,
  };
}
