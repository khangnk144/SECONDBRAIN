/**
 * Test helpers for the layout style (F35.1). Unit and component tests default to the calm style
 * (`DEFAULT_STYLE` is 'calm' under `MODE === 'test'`, and `src/test/setup.ts` resets it after
 * every test), so the tests written before Bento keep their layout. A Bento test opts in:
 *
 *   beforeEach(() => withStyle('bento'));   // or inside the test, before rendering
 *
 * Call it per test (beforeEach or the test body), not in beforeAll: the reset runs after each test.
 */
import { DEFAULT_STYLE, type Style } from '../ui-prefs';
import { useUiPrefsStore } from '../ui-prefs-store';

/** Shows `style` (store + `data-style` on <html>) and returns a function that puts back the previous one. */
export function withStyle(style: Style, doc: Document | undefined = currentDocument()): () => void {
  const previous = useUiPrefsStore.getState().prefs.style;
  setStyle(style, doc);
  return () => setStyle(previous, doc);
}

/** Back to the test default (calm); `src/test/setup.ts` calls it after every test. */
export function resetUiStyle(doc: Document | undefined = currentDocument()): void {
  setStyle(DEFAULT_STYLE, doc);
}

/** `@vitest-environment node` tests have no DOM: only the store is reset there. */
function currentDocument(): Document | undefined {
  return typeof document === 'undefined' ? undefined : document;
}

function setStyle(style: Style, doc: Document | undefined): void {
  const { prefs, setPrefs } = useUiPrefsStore.getState();
  if (prefs.style !== style) setPrefs({ ...prefs, style });
  if (doc) doc.documentElement.dataset.style = style;
}
