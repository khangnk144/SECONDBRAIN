/**
 * jsdom has no layout: ProseMirror asks a Range for its boxes when a command scrolls the caret
 * into view (`chain().focus()`). Empty boxes are enough for tests.
 */
export function installRangeLayoutShim(): void {
  const range = Range.prototype as unknown as Record<string, unknown>;
  range['getClientRects'] ??= () => [];
  range['getBoundingClientRect'] ??= () => new DOMRect();
}
