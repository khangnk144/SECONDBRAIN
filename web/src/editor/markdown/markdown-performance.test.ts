// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { editWordInBlock, middleEditableBlock } from './__tests__/document-edits';
import { largeNote, manyBlockNote } from './__tests__/large-notes';
import { loadMarkdown, saveMarkdown, saveMarkdownWithSnapshot } from './markdown-document';

function timed<T>(run: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = run();
  return { value, ms: performance.now() - started };
}

describe('converter performance', () => {
  it('loads and saves the 2 MB note', () => {
    const note = largeNote();
    expect(note.length).toBeGreaterThanOrEqual(2_000_000);
    const load = timed(() => loadMarkdown(note));
    const { doc, snapshot } = load.value;
    const save = timed(() => saveMarkdown(doc, snapshot));
    expect(save.value).toBe(note);
    const edited = editWordInBlock(doc, middleEditableBlock(doc) ?? 0);
    const editSave = timed(() => saveMarkdownWithSnapshot(edited, snapshot));
    expect(editSave.value.exact).toBe(true);
    console.info(
      `2 MB note (${doc.childCount} blocks): load ${load.ms.toFixed(0)} ms, ` +
        `save ${save.ms.toFixed(0)} ms, save after one edit ${editSave.ms.toFixed(0)} ms`,
    );
    // Generous bounds for a shared CI machine; the report records the measured numbers.
    expect(load.ms).toBeLessThan(20_000);
    expect(save.ms).toBeLessThan(1_500);
    expect(editSave.ms).toBeLessThan(1_500);
  }, 60_000);

  it('saves a 5,000-block note after a one-block edit in well under 100 ms', () => {
    const { doc, snapshot } = loadMarkdown(manyBlockNote(5000));
    expect(doc.childCount).toBe(5000);
    const samples: number[] = [];
    for (const index of [1, 2501, 2502, 4998]) {
      const edited = editWordInBlock(doc, index);
      const save = timed(() => saveMarkdownWithSnapshot(edited, snapshot));
      expect(save.value.exact).toBe(true);
      samples.push(save.ms);
    }
    console.info(
      `5,000-block note, one-block edit: ${samples.map((ms) => ms.toFixed(1)).join(', ')} ms`,
    );
    expect(Math.max(...samples)).toBeLessThan(100);
  }, 60_000);
});
