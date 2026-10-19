/**
 * Keeps keyboard focus somewhere useful when the element holding it disappears (a tab switch
 * replaces the editor, a pane collapses, a toast closes). Focus that fell to `<body>` would send
 * the next key nowhere and force the user to Tab from the top again (WCAG 2.4.3).
 */
export const MAIN_REGION_ID = 'main-content';
/** The note body (rich text or source mode) of the note on screen. */
const EDITOR_SELECTOR = `#${MAIN_REGION_ID} .ProseMirror[contenteditable="true"], #${MAIN_REGION_ID} textarea.source-editor`;
const ACTIVE_TAB_SELECTOR = '.tab-bar [aria-current="page"]';

/** True when nothing useful has focus (body, nothing, or an element that left the page). */
export function focusIsLost(doc: Document = document): boolean {
  const active = doc.activeElement;
  return !active || active === doc.body || !active.isConnected;
}

export function focusMainRegion(doc: Document = document): void {
  doc.getElementById(MAIN_REGION_ID)?.focus();
}

/** Focuses `target` if it is still on the page, else the main region. */
export function focusOrMain(target: HTMLElement | null, doc: Document = document): void {
  if (target?.isConnected) {
    target.focus();
    if (doc.activeElement === target) return;
  }
  focusMainRegion(doc);
}

export interface RecoverFocusOptions {
  /** A note screen is coming: wait for its editor and focus it. */
  expectEditor: boolean;
  /** How long to wait for the editor before falling back to the active tab, then main. */
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * After a navigation: if focus gets lost (now or while the new screen loads), put it in the new
 * note's editor, else on the active tab, else on the main region. Never takes focus away from an
 * element that something else focused meanwhile. Returns a cancel function.
 */
export function recoverFocusAfterNavigation(options: RecoverFocusOptions): () => void {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const intervalMs = options.intervalMs ?? 50;
  const start = document.activeElement;
  let elapsed = 0;
  let handle: ReturnType<typeof setTimeout> | null = null;

  const tick = () => {
    handle = null;
    const lost = focusIsLost();
    // Someone (the user, the note screen) moved focus on purpose: leave it there.
    if (!lost && document.activeElement !== start) return;
    if (lost) {
      const editor = options.expectEditor
        ? document.querySelector<HTMLElement>(EDITOR_SELECTOR)
        : null;
      if (editor) return editor.focus();
      if (!options.expectEditor || elapsed >= timeoutMs) {
        const tab = document.querySelector<HTMLElement>(ACTIVE_TAB_SELECTOR);
        return focusOrMain(options.expectEditor ? tab : null);
      }
    } else if (elapsed >= timeoutMs) {
      return;
    }
    elapsed += intervalMs;
    handle = setTimeout(tick, intervalMs);
  };

  handle = setTimeout(tick, 0);
  return () => {
    if (handle !== null) clearTimeout(handle);
  };
}
