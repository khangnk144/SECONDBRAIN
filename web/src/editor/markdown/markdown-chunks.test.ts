// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { corpus } from './__tests__/corpus-files';
import { loadMarkdown } from './markdown-document';
import { chunkCandidates } from './markdown-chunks';
import { parseMarkdown, parseWhole } from './markdown-parser';

function offsetsOnly(value: unknown): string {
  return JSON.stringify(value, (key, inner: unknown) =>
    key === 'line' || key === 'column' ? undefined : inner,
  );
}

function expectSameAsWhole(text: string): void {
  const chunked = parseMarkdown(text, { chunkTarget: 1 });
  expect(offsetsOnly(chunked.root.children), text).toBe(offsetsOnly(parseWhole(text).children));
}

const TRICKY = {
  'fenced code with blank lines and column-0 lines':
    '```\na\n\nnot a heading\n\n# still code\n```\n\nafter\n',
  'tilde fence never closed': '~~~\ncode\n\ntext at column 0\n\nmore\n',
  'HTML comment across blank lines': '<!--\n\ncomment\n\n-->\n\nafter\n',
  'script block across blank lines': '<script>\nx\n\ny\n</script>\n\nafter\n',
  'unclosed pre inside a list item': '- a\n\n  - [ ] b\n\t<pre>\n\nnext [[x]]\n',
  'empty list item after indented code': '    code\n\n+\n\n***\n',
  'ordered item after indented code': '    code\n\n2. two\n',
  'loose list across blank lines': '- a\n\n- b\n\n\n- c\n',
  'list then paragraph': '- a\n\nparagraph\n\n- b\n',
  'block quote then lazy text': '> a\n\nb\n> c\n',
  'footnote definition with indented content': '[^1]: note\n\n    more\n\nafter\n',
  'table then text': '| a |\n| - |\n| 1 |\n\ntext\n',
};

describe('chunked parsing equals one whole parse', () => {
  it('proposes cuts only after a blank line, before a non-list line at column 0', () => {
    expect(chunkCandidates('a\n\nb\n\n- c\n\n  d\n\n1. e\n\nf')).toEqual([3, 22]);
  });

  it.each(corpus)('$name', ({ content }) => {
    expectSameAsWhole(content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'));
  });

  it.each(Object.entries(TRICKY))('%s', (_name, text) => {
    expectSameAsWhole(text);
  });

  it('resolves references whose definition is in a far chunk', () => {
    const filler = 'Đoạn văn bình thường.\n\n'.repeat(400);
    const text = `See [the doc][ref] here.\n\n${filler}[ref]: https://example.com\n`;
    const { root, definitionsPrefix } = parseMarkdown(text);
    expect(definitionsPrefix).toContain('[ref]: https://example.com');
    expect(offsetsOnly(root.children)).toBe(offsetsOnly(parseWhole(text).children));
    const { doc } = loadMarkdown(text);
    expect(doc.child(0).type.name).toBe('verbatimBlock');
  });

  it('parses in one piece when a definition sits inside a container', () => {
    const filler = 'Đoạn văn.\n\n'.repeat(600);
    const text = `See [x].\n\n${filler}> [x]: https://example.com\n`;
    expect(offsetsOnly(parseMarkdown(text).root.children)).toBe(
      offsetsOnly(parseWhole(text).children),
    );
  });
});
