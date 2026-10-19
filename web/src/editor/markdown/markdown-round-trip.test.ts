// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { allVariants, corpus } from './__tests__/corpus-files';
import {
  blockRanges,
  editWordInBlock,
  findTasks,
  middleEditableBlock,
  tickTask,
  untickTask,
} from './__tests__/document-edits';
import { changedLines, changedRange, splitLines, unifiedDiff } from './__tests__/text-diff';
import { loadMarkdown, saveMarkdown, saveMarkdownWithSnapshot } from './markdown-document';

const cases = corpus.flatMap((file) =>
  allVariants(file.content).map((variant) => ({
    name: `${file.name} [${variant.label}]`,
    content: variant.content,
  })),
);

describe('round-trip corpus (F3.1)', () => {
  it('has at least 40 files', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(40);
  });

  it.each(cases)('$name: no edit gives the identical text', ({ content }) => {
    const { doc, snapshot } = loadMarkdown(content);
    expect(saveMarkdown(doc, snapshot)).toBe(content);
  });

  it.each(cases)('$name: a one-word edit changes only that block', ({ content }) => {
    const { doc, snapshot } = loadMarkdown(content);
    const index = middleEditableBlock(doc);
    if (index === null) return;
    const edited = editWordInBlock(doc, index);
    const output = saveMarkdown(edited, snapshot);
    const [blockStart, blockEnd] = blockRanges(snapshot)[index] as [number, number];
    const change = changedRange(content, output);
    expect(output).toContain('EDITED');
    expect(change.start, unifiedDiff(content, output)).toBeGreaterThanOrEqual(blockStart);
    expect(change.end, unifiedDiff(content, output)).toBeLessThanOrEqual(blockEnd);
    expect(loadMarkdown(output).doc.child(index).textContent).toContain('EDITED');
  });

  it.each(cases)(
    '$name: ticking a task changes exactly its line; unticking restores',
    ({ content }) => {
      const { doc, snapshot } = loadMarkdown(content);
      const task = findTasks(doc).find((candidate) => !candidate.checked);
      if (!task) return;
      const tickedDoc = tickTask(doc, task.pos);
      const ticked = saveMarkdownWithSnapshot(tickedDoc, snapshot);
      const lines = changedLines(content, ticked.text);
      expect(lines, unifiedDiff(content, ticked.text)).toHaveLength(1);
      const before = splitLines(content)[lines![0]!] as string;
      const after = splitLines(ticked.text)[lines![0]!] as string;
      const [, body = '', ending = ''] = /^(.*?)(\r\n|\n|\r)?$/su.exec(before) ?? [];
      const content_ = body.replace(/[ \t]+$/, '');
      const expected =
        content_.replace(/\[ \]/, '[x]') + ' ✅ 2026-10-19' + body.slice(content_.length) + ending;
      expect(after).toBe(expected);
      // Untick with the snapshot returned by the save, and again after a fresh load.
      const restored = saveMarkdown(untickTask(tickedDoc, task.pos), ticked.snapshot);
      expect(restored, unifiedDiff(content, restored)).toBe(content);
      const reloaded = loadMarkdown(ticked.text);
      expect(saveMarkdown(untickTask(reloaded.doc, task.pos), reloaded.snapshot)).toBe(content);
    },
  );

  it.each(cases)('$name: unticking a done task removes only the x and its token', ({ content }) => {
    const { doc, snapshot } = loadMarkdown(content);
    const task = findTasks(doc).find((candidate) => candidate.checked);
    if (!task) return;
    const output = saveMarkdown(untickTask(doc, task.pos), snapshot);
    const lines = changedLines(content, output);
    expect(lines, unifiedDiff(content, output)).toHaveLength(1);
    const before = splitLines(content)[lines![0]!] as string;
    const after = splitLines(output)[lines![0]!] as string;
    expect(after).toBe(before.replace(/\[[xX]\]/, '[ ]').replace(/ ✅ \d{4}-\d{2}-\d{2}/u, ''));
  });
});
