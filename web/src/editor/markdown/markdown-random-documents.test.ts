// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  blockRanges,
  editableBlocks,
  editWordInBlock,
  findTasks,
  firstLineEndsInsideMarks,
  tickTask,
  untickTask,
} from './__tests__/document-edits';
import { createRandom, supportedDocument } from './__tests__/random-markdown';
import { changedLines, changedRange, splitLines, unifiedDiff } from './__tests__/text-diff';
import { loadMarkdown, saveMarkdown, saveMarkdownWithSnapshot } from './markdown-document';
import type { MarkdownSnapshot } from './markdown-snapshot';
import { normalizeForMarkdown } from './save-normalize';

const SEEDS = Array.from({ length: 520 }, (_, index) => index + 1);
// Batches keep each test case short; together they cover every seed.
const BATCHES = Array.from({ length: 13 }, (_, batch) => ({
  batch,
  seeds: SEEDS.slice(batch * 40, batch * 40 + 40),
}));
const TIMEOUT = 30_000;

/** A snapshot without any original block: every node is serialised canonically. */
function emptySnapshot(snapshot: MarkdownSnapshot): MarkdownSnapshot {
  return {
    ...snapshot,
    bom: false,
    frontmatter: '',
    blocks: [],
    trailing: '',
    definitionsPrefix: '',
  };
}

/** `after` is `before` with a checkbox ticked and/or the done token added. */
function isTickOf(before: string, after: string): boolean {
  const withoutToken = after.replace(' ✅ 2026-10-19', '');
  return withoutToken === before || withoutToken.replace('[x]', '[ ]') === before;
}

describe('seeded random documents from the supported grammar (F3.1)', () => {
  it.each(BATCHES)(
    'round-trips every document byte for byte, LF and CRLF (batch $batch)',
    ({ seeds }) => {
      for (const seed of seeds) {
        const source = supportedDocument(createRandom(seed));
        for (const text of [source, source.replace(/\n/g, '\r\n')]) {
          const { doc, snapshot } = loadMarkdown(text);
          expect(saveMarkdown(doc, snapshot), `seed ${seed}`).toBe(text);
        }
      }
    },
    TIMEOUT,
  );

  it.each(BATCHES)(
    're-parses the canonical serialisation to the same content (batch $batch)',
    ({ seeds }) => {
      for (const seed of seeds) {
        const { doc, snapshot } = loadMarkdown(supportedDocument(createRandom(seed)));
        const canonical = saveMarkdownWithSnapshot(doc, emptySnapshot(snapshot));
        expect(canonical.exact, `seed ${seed}\n${canonical.text}`).toBe(true);
        const reloaded = loadMarkdown(canonical.text).doc;
        expect(reloaded.eq(normalizeForMarkdown(doc)), `seed ${seed}\n${canonical.text}`).toBe(
          true,
        );
      }
    },
    TIMEOUT,
  );

  it.each(BATCHES)(
    'keeps a one-word edit inside its block (batch $batch)',
    ({ seeds }) => {
      for (const seed of seeds) {
        const random = createRandom(seed);
        const source = supportedDocument(random);
        const { doc, snapshot } = loadMarkdown(source);
        const editable = editableBlocks(doc);
        if (editable.length === 0) continue;
        const index = editable[Math.floor(random() * editable.length)] as number;
        const saved = saveMarkdownWithSnapshot(editWordInBlock(doc, index), snapshot);
        const [start, end] = blockRanges(snapshot)[index] as [number, number];
        const change = changedRange(source, saved.text);
        const message = `seed ${seed} block ${index}\n${unifiedDiff(source, saved.text)}`;
        expect(saved.exact, message).toBe(true);
        expect(change.start, message).toBeGreaterThanOrEqual(start);
        expect(change.end, message).toBeLessThanOrEqual(end);
        expect(loadMarkdown(saved.text).doc.child(index).textContent, message).toContain('EDITED');
      }
    },
    TIMEOUT,
  );

  it(
    'ticks a task with a text patch and unticks back to the original bytes',
    () => {
      let ticked = 0;
      for (const seed of SEEDS) {
        const random = createRandom(seed);
        const source = supportedDocument(random);
        const { doc, snapshot } = loadMarkdown(source);
        const tasks = findTasks(doc).filter((task) => !task.checked);
        const task = tasks[Math.floor(random() * tasks.length)];
        if (!task || firstLineEndsInsideMarks(doc, task.pos)) continue;
        ticked += 1;
        const tickedDoc = tickTask(doc, task.pos);
        const saved = saveMarkdownWithSnapshot(tickedDoc, snapshot);
        const message = `seed ${seed}\n${unifiedDiff(source, saved.text)}`;
        const lines = changedLines(source, saved.text);
        expect(lines, message).not.toBeNull();
        expect(lines!.length, message).toBeLessThanOrEqual(2);
        for (const line of lines!) {
          expect(isTickOf(splitLines(source)[line]!, splitLines(saved.text)[line]!), message).toBe(
            true,
          );
        }
        expect(saveMarkdown(untickTask(tickedDoc, task.pos), saved.snapshot), message).toBe(source);
      }
      expect(ticked).toBeGreaterThan(30);
    },
    TIMEOUT * 2,
  );
});
