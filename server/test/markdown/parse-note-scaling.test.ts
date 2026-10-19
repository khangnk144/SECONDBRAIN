/**
 * Parsing must stay (near) linear on large or adversarial notes: one huge paragraph, deep
 * nesting, thousands of unterminated constructs. Limits are generous (a slow CI machine must
 * pass); the measured times are printed for the milestone report.
 */
import { describe, expect, it } from 'vitest';
import { parseNote } from '../../src/markdown/parse-note.js';

function timed(label: string, content: string): { ms: number; note: ReturnType<typeof parseNote> } {
  parseNote(content.slice(0, 2000)); // warm-up
  const started = performance.now();
  const note = parseNote(content);
  const ms = performance.now() - started;
  console.info(`${label}: ${(content.length / 1e6).toFixed(2)} MB in ${ms.toFixed(0)} ms`);
  return { ms, note };
}

describe('parseNote scales linearly', () => {
  it('parses a 2 MB single paragraph well under a second', () => {
    const dense = 'Giải tích [[Bài 1]] #tag và `code` **bold** [x](a.md).\n'.repeat(2e6 / 55);
    const { ms, note } = timed('2 MB dense paragraph', dense);
    expect(ms).toBeLessThan(1000);
    expect(note.links.length).toBe(Math.floor(2e6 / 55) * 2);
    const prose = 'Giải tích là môn nền tảng, xem [[Bài 1]] để ôn tập khái niệm giới hạn.\n';
    expect(timed('2 MB prose paragraph', prose.repeat(2e6 / prose.length)).ms).toBeLessThan(1000);
  });

  it('handles deeply nested lists and quotes', () => {
    const list = Array.from({ length: 1500 }, (_, i) => `${' '.repeat(i * 2)}- [ ] t`).join('\n');
    const { ms, note } = timed('1500-deep task list', list);
    expect(ms).toBeLessThan(1500);
    expect(note.tasks).toHaveLength(1500);
    expect(timed('500 nested quotes', `${'> '.repeat(500)}x [[A]]\n`).note.links).toHaveLength(1);
  });

  it('does not rescan the rest of a paragraph for every unterminated construct', () => {
    const cases: [string, string][] = [
      ['20k unterminated comments', 'text <!--'.repeat(20000)],
      ['20k unterminated PIs', 'text <?'.repeat(20000)],
      ['30k unmatched backtick runs', '`a``b```c'.repeat(30000)],
      ['200k open brackets', '['.repeat(200000)],
      ['50k unclosed link tails', '[a]('.repeat(50000)],
      ['20k table rows', `| a | b |\n|---|---|\n${'| [[x]] | `y` |\n'.repeat(20000)}`],
    ];
    for (const [label, content] of cases) expect(timed(label, content).ms).toBeLessThan(1500);
  });
});
