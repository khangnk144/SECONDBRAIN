// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadMarkdown } from '../../editor/markdown/markdown-document';
import { blockIndexForLine } from './line-to-block';

describe('file line to top-level block (&line=N)', () => {
  it('counts the front matter and blank lines like the server (1-based)', () => {
    const { snapshot } = loadMarkdown(
      '---\ntype: note\n---\n# A\n\nĐoạn một\ndòng hai\n\n- x\n- y\n',
    );
    expect(
      [1, 3, 4, 5, 6, 7, 8, 9, 10, 99].map((line) => blockIndexForLine(snapshot, line)),
    ).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 2]);
  });

  it('treats CRLF and a BOM the same', () => {
    const { snapshot } = loadMarkdown('﻿# A\r\n\r\nB\r\n');
    expect(blockIndexForLine(snapshot, 1)).toBe(0);
    expect(blockIndexForLine(snapshot, 3)).toBe(1);
  });
});
