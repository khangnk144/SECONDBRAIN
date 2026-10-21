import { describe, expect, it } from 'vitest';
import { parseAnswer, parseInline } from './answer-markdown';

describe('answer Markdown subset', () => {
  it('paragraphs, line breaks, bold, italic and inline code', () => {
    expect(parseAnswer('Một **đậm** và *nghiêng* với `mã`.\nDòng hai\n\nĐoạn hai')).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', text: 'Một ' },
          { kind: 'bold', children: [{ kind: 'text', text: 'đậm' }] },
          { kind: 'text', text: ' và ' },
          { kind: 'italic', children: [{ kind: 'text', text: 'nghiêng' }] },
          { kind: 'text', text: ' với ' },
          { kind: 'code', text: 'mã' },
          { kind: 'text', text: '.' },
          { kind: 'break' },
          { kind: 'text', text: 'Dòng hai' },
        ],
      },
      { kind: 'paragraph', children: [{ kind: 'text', text: 'Đoạn hai' }] },
    ]);
  });

  it('bullet and numbered lists, a bold line right before a list, indented continuations', () => {
    const blocks = parseAnswer('**Hôm nay**\n- Một\n- Hai\n  tiếp\n1. A\n2. B');
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'list', 'list']);
    expect(blocks[1]).toMatchObject({ ordered: false });
    expect(blocks[1]?.kind === 'list' && blocks[1].items[1]).toEqual([
      { kind: 'text', text: 'Hai' },
      { kind: 'break' },
      { kind: 'text', text: 'tiếp' },
    ]);
    expect(blocks[2]).toMatchObject({ ordered: true });
  });

  it('links with and without alias; a PDF page after the link is attached to it', () => {
    expect(parseInline('Xem [[1 Projects/Đồ án|Đồ án]] và [[Giải tích 1]].')).toEqual([
      { kind: 'text', text: 'Xem ' },
      { kind: 'link', target: '1 Projects/Đồ án', label: 'Đồ án', page: null },
      { kind: 'text', text: ' và ' },
      { kind: 'link', target: 'Giải tích 1', label: 'Giải tích 1', page: null },
      { kind: 'text', text: '.' },
    ]);
    expect(parseInline('[[bài báo.pdf]] (tr. 4)')[0]).toEqual({
      kind: 'link',
      target: 'bài báo.pdf',
      label: 'bài báo.pdf',
      page: 4,
    });
    expect(parseInline('[[paper.pdf]] (p. 12)')[0]).toMatchObject({ page: 12 });
  });

  it('never turns text into HTML and leaves odd syntax as text', () => {
    const html = '<img src=x onerror=alert(1)> <b>x</b>';
    expect(parseAnswer(html)).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: html }] },
    ]);
    expect(parseInline('2 * 3 * 4')).toEqual([{ kind: 'text', text: '2 * 3 * 4' }]);
    expect(parseInline('[[ ]] và [[mở')).toEqual([{ kind: 'text', text: '[[ ]] và [[mở' }]);
    expect(parseInline('** không đậm**')).toEqual([{ kind: 'text', text: '** không đậm**' }]);
  });

  it('finds links exactly where the server checks them: escaped, innermost [[, \\| alias', () => {
    // The server's citation check treats `\[[…]]` as a link too, so it was checked.
    expect(parseInline('Theo \\[[Đồ án]] nhé')).toEqual([
      { kind: 'text', text: 'Theo \\' },
      { kind: 'link', target: 'Đồ án', label: 'Đồ án', page: null },
      { kind: 'text', text: ' nhé' },
    ]);
    expect(parseInline('[[[Đồ án]]]')).toEqual([
      { kind: 'text', text: '[' },
      { kind: 'link', target: 'Đồ án', label: 'Đồ án', page: null },
      { kind: 'text', text: ']' },
    ]);
    expect(parseInline('[[Đồ án\\|đồ án]]')).toEqual([
      { kind: 'link', target: 'Đồ án', label: 'đồ án', page: null },
    ]);
  });

  it('a heading line becomes a bold paragraph', () => {
    expect(parseAnswer('## Tóm tắt\nNội dung')).toEqual([
      {
        kind: 'paragraph',
        children: [{ kind: 'bold', children: [{ kind: 'text', text: 'Tóm tắt' }] }],
      },
      { kind: 'paragraph', children: [{ kind: 'text', text: 'Nội dung' }] },
    ]);
  });
});
