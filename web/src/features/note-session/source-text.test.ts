// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { displayText, fileTextFromDisplay, sourceBase } from './source-text';

describe('source mode text (F3.8)', () => {
  it('shows CRLF as LF and hides the BOM, and gives the exact bytes back unchanged', () => {
    const file = '\uFEFF---\r\ntags: [a]\r\n---\r\n# Tiêu đề\r\n\r\nĐoạn văn\r\n';
    const base = sourceBase(file, '\r\n');
    expect(displayText(base)).toBe('---\ntags: [a]\n---\n# Tiêu đề\n\nĐoạn văn\n');
    expect(fileTextFromDisplay(displayText(base), base)).toBe(file);
  });

  it('writes typed lines with the file line ending and keeps the BOM', () => {
    const file = '\uFEFFa\r\nb\r\n';
    const base = sourceBase(file, '\r\n');
    expect(fileTextFromDisplay('a\nb\nc\n', base)).toBe('\uFEFFa\r\nb\r\nc\r\n');
    expect(fileTextFromDisplay('a\nB\n', base)).toBe('\uFEFFa\r\nB\r\n');
  });

  it('keeps the ending of every untouched line in a mixed file', () => {
    const file = 'one\r\ntwo\nthree\rfour';
    const base = sourceBase(file, '\r\n');
    expect(displayText(base)).toBe('one\ntwo\nthree\nfour');
    expect(fileTextFromDisplay('one\ntwo\nthree\nfour', base)).toBe(file);
    expect(fileTextFromDisplay('one\nTWO\nthree\nfour', base)).toBe('one\r\nTWO\r\nthree\rfour');
  });

  it('handles a missing final newline, an added final newline and an empty file', () => {
    const base = sourceBase('x\ny', '\n');
    expect(fileTextFromDisplay('x\ny\n', base)).toBe('x\ny\n');
    expect(fileTextFromDisplay('x', base)).toBe('x');
    const empty = sourceBase('', '\n');
    expect(displayText(empty)).toBe('');
    expect(fileTextFromDisplay('new\n', empty)).toBe('new\n');
  });
});
