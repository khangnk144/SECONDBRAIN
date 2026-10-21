import { useEffect, useRef, type RefObject } from 'react';
import type { GraphCanvasHandle } from './graph-canvas';
import { KEY_ZOOM_FACTOR } from './graph-viewport';

export type GraphViewKeyAction = 'reset' | 'zoomIn' | 'zoomOut' | 'clear';

/**
 * Keys the brain map answers to while it is on screen (the shortcut sheet lists them). Key names
 * are the same in every language; `=` and `_` also zoom (the unshifted `+` / `-` keys).
 */
export const GRAPH_VIEW_KEYS: ReadonlyArray<{ keys: string; action: GraphViewKeyAction }> = [
  { keys: '0', action: 'reset' },
  { keys: '+', action: 'zoomIn' },
  { keys: '-', action: 'zoomOut' },
  { keys: 'Esc', action: 'clear' },
];

const KEY_ACTIONS: Readonly<Record<string, GraphViewKeyAction>> = {
  ...Object.fromEntries(
    GRAPH_VIEW_KEYS.map(({ keys, action }) => [keys === 'Esc' ? 'Escape' : keys, action]),
  ),
  '=': 'zoomIn',
  _: 'zoomOut',
};

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** An overlay (dialog, palette, capture box, menu) is open or holds the key: its Esc wins. */
function overlayActive(target: EventTarget | null): boolean {
  if (document.querySelector('[aria-modal="true"]')) return true;
  return target instanceof Element && target.closest('[role="dialog"], [role="menu"]') !== null;
}

/**
 * `0` resets the view, `+` / `-` zoom, `Esc` clears the selection (like "Bỏ chọn") while the
 * brain map is on screen. Keys typed into the side panel's search box (or any field), keys an
 * open overlay handles, and modifier combinations (Ctrl+0 is the browser's zoom) are left alone.
 * `onEscape` answers whether there was a selection to clear.
 */
export function useGraphViewKeys(
  canvas: RefObject<GraphCanvasHandle | null>,
  onEscape: () => boolean = () => false,
): void {
  const latestOnEscape = useRef(onEscape);
  useEffect(() => {
    latestOnEscape.current = onEscape;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditable(event.target)) return;
      const action = KEY_ACTIONS[event.key];
      if (action === 'clear') {
        if (!overlayActive(event.target) && latestOnEscape.current()) event.preventDefault();
        return;
      }
      const handle = canvas.current;
      if (!handle || !action) return;
      if (action === 'reset') handle.resetView();
      else handle.zoomBy(action === 'zoomIn' ? KEY_ZOOM_FACTOR : 1 / KEY_ZOOM_FACTOR);
      event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [canvas]);
}
