/**
 * End-to-end search timing (SPEC F8.1: keystroke to results ≤ 200 ms p95 after the debounce):
 * each input event sets a mark; when the results for exactly that query are on screen a
 * `palette:keystroke-to-results` measure is recorded. The p95 is read in a real browser from
 * `performance.getEntriesByName(PALETTE_MEASURE)`.
 */
export const PALETTE_MEASURE = 'palette:keystroke-to-results';
const START_MARK = 'palette:keystroke';

let pendingQuery: string | null = null;

/** The input just changed to `query`. */
export function markPaletteKeystroke(query: string): void {
  pendingQuery = query;
  try {
    performance.clearMarks(START_MARK);
    performance.mark(START_MARK);
  } catch {
    // The User Timing API is optional; the palette works without it.
  }
}

/** Results answering `answered` were rendered; records the measure for the last keystroke. */
export function measurePaletteResults(answered: string | null): void {
  if (pendingQuery === null || answered !== pendingQuery) return;
  pendingQuery = null;
  try {
    performance.measure(PALETTE_MEASURE, START_MARK);
    performance.clearMarks(START_MARK);
  } catch {
    // Mark missing (cleared elsewhere) or no User Timing API: nothing to record.
  }
}
