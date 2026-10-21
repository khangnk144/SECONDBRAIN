import { describe, expect, it } from 'vitest';
import {
  validateCitations,
  type CitationContext,
} from '../../../src/ai/citations/validate-citations.js';
import type { RetrievedSource } from '../../../src/ai/retrieval/retrieval-types.js';
import { buildLinkCatalog } from '../../../src/markdown/link-catalog.js';

const catalog = buildLinkCatalog([
  '2 Areas/Đại số tuyến tính – chương 3.md',
  '2 Areas/Giải tích 1.md',
  '1 Projects/Bí mật.md',
  '1 Projects/Ghi chú.md',
  '2 Areas/Ghi chú.md',
  '3 Resources/papers/Ma trận.pdf',
  '3 Resources/papers/Trùng tên.pdf',
  'Attachments/Trùng tên.pdf',
]);

const source = (
  id: string,
  path: string,
  title: string,
  page: number | null = null,
): RetrievedSource => ({
  id,
  path,
  title,
  page,
  chunks: [],
});

const SOURCES = [
  source('S1', '2 Areas/Đại số tuyến tính – chương 3.md', 'Đại số tuyến tính – chương 3'),
  source('S2', '3 Resources/papers/Ma trận.pdf', 'Ma trận', 4),
  source('S3', '3 Resources/papers/Trùng tên.pdf', 'Trùng tên', 2),
];

const context = (overrides: Partial<CitationContext> = {}): CitationContext => ({
  sources: SOURCES,
  allowedPaths: new Set(SOURCES.map((s) => s.path)),
  catalog,
  fromPath: '',
  language: 'vi',
  ...overrides,
});

describe('citation validation (F33.2)', () => {
  it('turns known markers into links and drops unknown ones', () => {
    const result = validateCitations(
      'Ma trận vuông có định thức [S1]. Trị riêng [S9] được nói ở trang 4 [S2]. Hết [S1, S9].',
      context(),
    );
    expect(result.answer).toBe(
      'Ma trận vuông có định thức [[2 Areas/Đại số tuyến tính – chương 3|Đại số tuyến tính – chương 3]]. Trị riêng được nói ở trang 4 [[Ma trận.pdf]] (tr. 4). Hết [[2 Areas/Đại số tuyến tính – chương 3|Đại số tuyến tính – chương 3]].',
    );
    expect(result.rejected).toEqual(['S9', 'S9']);
    expect(result.citations).toEqual([
      {
        path: '2 Areas/Đại số tuyến tính – chương 3.md',
        title: 'Đại số tuyến tính – chương 3',
        page: null,
      },
      { path: '3 Resources/papers/Ma trận.pdf', title: 'Ma trận', page: 4 },
    ]);
  });

  it('keeps model links only when they resolve inside the retrieved set', () => {
    const result = validateCitations(
      'Xem [[Đại số tuyến tính – chương 3]], [[1 Projects/Bí mật.md]], [[Giải tích 1|giải tích]], [[Ghi chú]] và [[Không có]].',
      context(),
    );
    expect(result.answer).toBe(
      'Xem [[Đại số tuyến tính – chương 3]], Bí mật, giải tích, Ghi chú và Không có.',
    );
    expect(result.rejected).toEqual(['1 Projects/Bí mật.md', 'Giải tích 1', 'Ghi chú', 'Không có']);
    expect(result.citations.map((c) => c.path)).toEqual([
      '2 Areas/Đại số tuyến tính – chương 3.md',
    ]);
  });

  it('reads [[S1]] as a marker and writes the path form for a file name that is not unique', () => {
    const result = validateCitations('A [[S1]] B [S3]', context({ language: 'en' }));
    expect(result.answer).toBe(
      'A [[2 Areas/Đại số tuyến tính – chương 3|Đại số tuyến tính – chương 3]] B [[3 Resources/papers/Trùng tên.pdf]] (p. 2)',
    );
    expect(result.rejected).toEqual([]);
  });

  it('reports an answer without any valid citation as having none', () => {
    const result = validateCitations('Không có trích dẫn nào [S7].', context());
    expect(result.citations).toEqual([]);
    expect(result.answer).toBe('Không có trích dẫn nào.');
    expect(result.rejected).toEqual(['S7']);
  });

  it('checks an escaped link like any other (the answer view shows it as a link)', () => {
    const result = validateCitations(
      'Theo ghi chú \\[[1 Projects/Bí mật]] và \\[[Đại số tuyến tính – chương 3]].',
      context(),
    );
    expect(result.answer).toBe('Theo ghi chú \\Bí mật và \\[[Đại số tuyến tính – chương 3]].');
    expect(result.rejected).toEqual(['1 Projects/Bí mật']);
    expect(result.citations.map((c) => c.path)).toEqual([
      '2 Areas/Đại số tuyến tính – chương 3.md',
    ]);
  });

  it.each([
    ['a removed marker', 'Xem [ [S9][1 Projects/Bí mật]] nhé.', 'Xem Bí mật nhé.'],
    [
      'a rejected link whose alias has a bracket',
      'Xem [[[x|[1 Projects/Bí mật]]]] nhé.',
      'Xem Bí mật nhé.',
    ],
    ['an empty title', 'Xem [[[.md]][1 Projects/Bí mật]] nhé.', 'Xem Bí mật nhé.'],
  ])('never lets %s join the brackets around it into an unchecked link', (_label, text, answer) => {
    const result = validateCitations(text, context());
    expect(result.answer).toBe(answer);
    expect(result.rejected).toContain('1 Projects/Bí mật');
    expect(result.citations).toEqual([]);
  });

  it('keeps its own source links on the second look, also next to brackets', () => {
    const result = validateCitations('[[S1]] [[S2]] [S3]]', context());
    expect(result.answer).toBe(
      '[[2 Areas/Đại số tuyến tính – chương 3|Đại số tuyến tính – chương 3]] [[Ma trận.pdf]] (tr. 4) [[3 Resources/papers/Trùng tên.pdf]] (tr. 2)]',
    );
    expect(result.rejected).toEqual([]);
  });
});
