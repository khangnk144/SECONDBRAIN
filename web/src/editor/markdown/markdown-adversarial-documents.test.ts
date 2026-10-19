// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { blockRanges, editableBlocks, editWordInBlock } from './__tests__/document-edits';
import { adversarialDocument, createRandom } from './__tests__/random-markdown';
import { changedRange, unifiedDiff } from './__tests__/text-diff';
import { loadMarkdown, saveMarkdown, saveMarkdownWithSnapshot } from './markdown-document';
import { parseMarkdown, parseWhole } from './markdown-parser';

const BATCHES = Array.from({ length: 8 }, (_, batch) => ({
  batch,
  seeds: Array.from({ length: 100 }, (_, index) => batch * 100 + index + 1),
}));
const TIMEOUT = 30_000;

/** mdast without line/column (chunked parses only keep offsets exact). */
function offsetsOnly(value: unknown): string {
  return JSON.stringify(value, (key, inner: unknown) =>
    key === 'line' || key === 'column' ? undefined : inner,
  );
}

describe('seeded adversarial documents (F3.1, F3.2)', () => {
  it.each(BATCHES)(
    'round-trips every document byte for byte (batch $batch)',
    ({ seeds }) => {
      for (const seed of seeds) {
        const source = adversarialDocument(createRandom(seed));
        const { doc, snapshot } = loadMarkdown(source);
        expect(saveMarkdown(doc, snapshot), `seed ${seed}`).toBe(source);
      }
    },
    TIMEOUT,
  );

  it.each(BATCHES)(
    'parses in small chunks exactly like one whole parse (batch $batch)',
    ({ seeds }) => {
      for (const seed of seeds) {
        const text = adversarialDocument(createRandom(seed))
          .replace(/^\uFEFF/, '')
          .replace(/\r\n?/g, '\n');
        const chunked = parseMarkdown(text, { chunkTarget: 1 });
        if (chunked.definitionsPrefix !== '') continue; // compared in markdown-chunks.test.ts
        expect(offsetsOnly(chunked.root.children), `seed ${seed}\n${text}`).toBe(
          offsetsOnly(parseWhole(text).children),
        );
      }
    },
    TIMEOUT,
  );

  it.each(BATCHES)(
    'keeps an edit inside its block and the gaps around it (batch $batch)',
    ({ seeds }) => {
      for (const seed of seeds) {
        const random = createRandom(seed);
        const source = adversarialDocument(random);
        const { doc, snapshot } = loadMarkdown(source);
        const editable = editableBlocks(doc);
        if (editable.length === 0) continue;
        const index = editable[Math.floor(random() * editable.length)] as number;
        const saved = saveMarkdownWithSnapshot(editWordInBlock(doc, index), snapshot);
        const ranges = blockRanges(snapshot);
        // Inexact content may need a blank line before or after it; other blocks never change.
        const from = index === 0 ? 0 : (ranges[index - 1] as [number, number])[1];
        const to = (ranges[index + 1] ?? [source.length])[0];
        const change = changedRange(source, saved.text);
        const message = `seed ${seed} block ${index}\n${unifiedDiff(source, saved.text)}`;
        expect(change.start, message).toBeGreaterThanOrEqual(from);
        expect(change.end, message).toBeLessThanOrEqual(to);
        const reloaded = loadMarkdown(saved.text).doc;
        expect(reloaded.textContent + JSON.stringify(reloaded.toJSON()), message).toContain(
          'EDITED',
        );
      }
    },
    TIMEOUT,
  );
});
