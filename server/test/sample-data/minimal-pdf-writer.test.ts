import { describe, expect, it } from 'vitest';
import { wrapText, writeOnePagePdf } from '../../src/sample-data/minimal-pdf-writer.js';
import { inspectPdf } from './pdf-structure.js';

describe('minimal PDF writer', () => {
  const pdf = writeOnePagePdf({
    title: 'Predicting (Course) Dropout \\ A Test',
    byline: ['A. Author, B. Author'],
    paragraphs: ['word '.repeat(300).trim(), 'Second paragraph.'],
  });

  it('writes a structurally valid PDF 1.4 whose xref offsets point at each object', () => {
    const { objects, text } = inspectPdf(pdf);
    expect(objects).toBe(7);
    expect(text).toContain('/Type /Catalog /Pages 2 0 R');
    expect(text).toContain('/Type /Pages /Kids [3 0 R] /Count 1');
    expect(text).toContain('/BaseFont /Helvetica');
  });

  it('escapes parentheses and backslashes in text', () => {
    const text = Buffer.from(pdf).toString('latin1');
    expect(text).toContain('(Predicting \\(Course\\) Dropout \\\\ A Test) Tj');
  });

  it('wraps long paragraphs to the page width', () => {
    const lines = wrapText('word '.repeat(300), 88);
    expect(lines.length).toBeGreaterThan(10);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(88);
  });

  it('is deterministic and refuses non-ASCII text', () => {
    const again = writeOnePagePdf({
      title: 'Predicting (Course) Dropout \\ A Test',
      byline: ['A. Author, B. Author'],
      paragraphs: ['word '.repeat(300).trim(), 'Second paragraph.'],
    });
    expect(Buffer.from(again).equals(Buffer.from(pdf))).toBe(true);
    expect(() => writeOnePagePdf({ title: 'Giải tích', paragraphs: [] })).toThrow(/ASCII/);
  });
});
