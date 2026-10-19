import type { Editor } from '@tiptap/core';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { EditorContext, PopupKeyHandler } from '../editor-context';
import { activeTrigger, type TriggerMatch } from '../extensions/editor-triggers';

/** The popup trigger the editor state currently holds (re-read after every transaction). */
export function useActiveTrigger(editor: Editor): TriggerMatch | null {
  return useSyncExternalStore(
    (onChange) => {
      editor.on('transaction', onChange);
      return () => {
        editor.off('transaction', onChange);
      };
    },
    () => (editor.isDestroyed ? null : activeTrigger(editor.state)),
  );
}

/** Routes keys typed in the editor to the open popup while it is mounted. */
export function usePopupKeys(context: EditorContext, handler: PopupKeyHandler): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const route: PopupKeyHandler = (event) => latest.current(event);
    context.popupKeyHandler = route;
    return () => {
      if (context.popupKeyHandler === route) context.popupKeyHandler = null;
    };
  }, [context]);
}

/**
 * The editor keeps the focus while a popup is open; `aria-activedescendant` on the editable root
 * tells assistive tech which option is active, `aria-controls` which popup it belongs to.
 */
export function useActiveDescendant(editor: Editor, controlsId: string, activeId: string | null) {
  useEffect(() => {
    const root = editor.view.dom;
    root.setAttribute('aria-controls', controlsId);
    if (activeId) root.setAttribute('aria-activedescendant', activeId);
    else root.removeAttribute('aria-activedescendant');
    return () => {
      root.removeAttribute('aria-controls');
      root.removeAttribute('aria-activedescendant');
    };
  }, [editor, controlsId, activeId]);
}

export interface PopupPlacement {
  left: number;
  top: number;
}

const GAP = 4;
const MARGIN = 8;

/**
 * Fixed position under the trigger's first character, flipped above it when there is no room
 * below, and kept inside the viewport. Measured again when `sizeKey` (what changes the popup's
 * size) changes.
 */
export function usePopupPlacement(editor: Editor, anchorPos: number, sizeKey: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<PopupPlacement>({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const anchor = anchorRect(editor, anchorPos);
    const box = ref.current?.getBoundingClientRect();
    const width = box?.width ?? 0;
    const height = box?.height ?? 0;
    const below = anchor.bottom + GAP;
    const fitsBelow = below + height + MARGIN <= window.innerHeight;
    const top = fitsBelow || anchor.top - GAP - height < MARGIN ? below : anchor.top - GAP - height;
    const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - width - MARGIN));
    setPlacement((current) =>
      current.left === left && current.top === top ? current : { left, top },
    );
  }, [editor, anchorPos, sizeKey]);

  return { ref, style: { left: placement.left, top: placement.top } };
}

function anchorRect(editor: Editor, pos: number): { left: number; top: number; bottom: number } {
  try {
    const coords = editor.view.coordsAtPos(pos);
    return { left: coords.left, top: coords.top, bottom: coords.bottom };
  } catch {
    // No layout (tests, hidden editor): place the popup at the editor's corner.
    const rect = editor.view.dom.getBoundingClientRect();
    return { left: rect.left, top: rect.top, bottom: rect.top };
  }
}

/** Active option index that goes back to the first option whenever `resetKey` changes. */
export function useActiveIndex(resetKey: string, count: number): [number, (index: number) => void] {
  const [active, setActive] = useState({ key: resetKey, index: 0 });
  const index = active.key === resetKey ? Math.min(active.index, Math.max(0, count - 1)) : 0;
  return [index, (next: number) => setActive({ key: resetKey, index: next })];
}
