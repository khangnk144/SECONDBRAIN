import { describe, expect, it } from 'vitest';
import { cleanHeadingText, extractOutline } from './outline-extract';

const levelsAndText = (content: string) =>
  extractOutline(content).map((h) => [h.level, h.text, h.line]);

describe('outline extraction', () => {
  it('lists ATX headings of levels 1 to 3 with 1-based lines', () => {
    const content = '# Đồ án Giải tích\n\n## Việc cần làm\n- [ ] x\n### Chi tiết #\n#### Quá sâu\n';
    expect(levelsAndText(content)).toEqual([
      [1, 'Đồ án Giải tích', 1],
      [2, 'Việc cần làm', 3],
      [3, 'Chi tiết', 5],
    ]);
  });

  it('ignores headings inside fenced code, whatever the fence', () => {
    const content = [
      '## Trước',
      '```md',
      '## Trong code',
      '```',
      '~~~~',
      '# Cũng trong code',
      '~~~',
      '# Vẫn trong code (fence ngắn hơn không đóng)',
      '~~~~',
      '## Sau',
    ].join('\n');
    expect(levelsAndText(content)).toEqual([
      [2, 'Trước', 1],
      [2, 'Sau', 10],
    ]);
  });

  it('treats an unclosed fence as code until the end', () => {
    expect(levelsAndText('# A\n```\n# B\n')).toEqual([[1, 'A', 1]]);
  });

  it('skips the front matter but counts its lines', () => {
    const content = '\uFEFF---\ntitle: x\n# not a heading\n---\r\n# Tiêu đề\r\n';
    expect(levelsAndText(content)).toEqual([[1, 'Tiêu đề', 5]]);
  });

  it('reads setext headings and keeps a lone --- as a thematic break', () => {
    const content = 'Tổng quan\n=========\n\n---\n\nPhần hai\nnối dòng\n---\n';
    expect(levelsAndText(content)).toEqual([
      [1, 'Tổng quan', 1],
      [2, 'Phần hai nối dòng', 6],
    ]);
  });

  it('does not take tags, list items or quotes for headings', () => {
    expect(levelsAndText('#môn/giải-tích\n- mục\n---\n> trích\n---\n')).toEqual([]);
  });

  it('shows link aliases and drops emphasis markers', () => {
    expect(cleanHeadingText('Ôn [[Giải tích 1|GT1]] và **[[Đại số]]** với `code`')).toBe(
      'Ôn GT1 và Đại số với code',
    );
    expect(cleanHeadingText('[Tài liệu](a.md) *quan trọng*')).toBe('Tài liệu quan trọng');
  });
});
