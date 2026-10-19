// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { editorSchema } from '../schema/editor-schema';
import { editWordInBlock } from './__tests__/document-edits';
import { changedLines, unifiedDiff } from './__tests__/text-diff';
import { loadMarkdown, saveMarkdownWithSnapshot } from './markdown-document';

/** One single-line block per index, in styles a canonical rewrite would change. */
function bigNote(count: number, block: (index: number) => string): string {
  return `${Array.from({ length: count }, (_, i) => block(i)).join('\n\n')}\n`;
}

const varied = (i: number): string =>
  i % 3 === 0
    ? `Paragraph ${i} with _emphasis_ and a\\*star.`
    : i % 3 === 1
      ? `## Heading number ${i} ##`
      : `+ item number ${i}`;

/** The same document rebuilt from JSON: equal content, no node shared with the snapshot. */
const withoutIdentity = (doc: ProseMirrorNode): ProseMirrorNode =>
  editorSchema.nodeFromJSON(doc.toJSON());

function children(doc: ProseMirrorNode): ProseMirrorNode[] {
  const list: ProseMirrorNode[] = [];
  doc.forEach((child) => list.push(child));
  return list;
}

function expectOnlyLines(before: string, after: string, lines: number[]): void {
  expect(changedLines(before, after), unifiedDiff(before, after)).toEqual(lines);
}

describe('edits far apart stay local (P2)', () => {
  for (const identity of ['kept', 'lost'] as const) {
    it(`rewrites only blocks 1 and 598 of 600 (node identity ${identity})`, () => {
      const source = bigNote(600, varied);
      const { doc, snapshot } = loadMarkdown(source);
      const edited = editWordInBlock(editWordInBlock(doc, 1), 598);
      const result = saveMarkdownWithSnapshot(
        identity === 'kept' ? edited : withoutIdentity(edited),
        snapshot,
      );
      expect(result.exact).toBe(true);
      expectOnlyLines(source, result.text, [2, 1196]);
    });
  }

  it('keeps repeated identical blocks byte-identical when node identity is lost', () => {
    const source = bigNote(600, () => 'Same _text_ here.');
    const { doc, snapshot } = loadMarkdown(source);
    const edited = withoutIdentity(editWordInBlock(editWordInBlock(doc, 1), 598));
    const result = saveMarkdownWithSnapshot(edited, snapshot);
    expect(result.exact).toBe(true);
    expectOnlyLines(source, result.text, [2, 1196]);
  });

  it('deletes and inserts far apart without touching the blocks between', () => {
    const source = bigNote(1500, varied);
    const { doc, snapshot } = loadMarkdown(source);
    const blocks = children(doc);
    blocks.splice(1400, 0, editorSchema.nodes['paragraph']!.create(null, editorSchema.text('New')));
    blocks.splice(3, 1);
    const edited = withoutIdentity(doc.copy(Fragment.fromArray(blocks)));
    const lines = source.split('\n\n');
    lines.splice(1400, 0, 'New');
    lines.splice(3, 1);
    const result = saveMarkdownWithSnapshot(edited, snapshot);
    expect(result.exact).toBe(true);
    expect(result.text).toBe(lines.join('\n\n'));
  });

  it('keeps unchanged blocks when most of a large note changed (patience fallback)', () => {
    const source = bigNote(2000, varied);
    const { doc, snapshot } = loadMarkdown(source);
    let edited = doc;
    for (let i = 0; i < 2000; i += 2) edited = editWordInBlock(edited, i);
    const result = saveMarkdownWithSnapshot(withoutIdentity(edited), snapshot);
    expect(result.exact).toBe(true);
    const unchanged = changedLines(source, result.text)!.filter((line) => line % 4 !== 0);
    expect(unchanged).toEqual([]);
  });
});
