import { describe, expect, it } from 'vitest';
import { AiError, type EmbeddingHit, type EmbeddingIndex } from '../../../src/ai/ai-types.js';
import { chunkMarkdown } from '../../../src/ai/note-chunks.js';
import { queryTerms, rankBm25 } from '../../../src/ai/retrieval/chunk-bm25.js';
import { reciprocalRankFusion } from '../../../src/ai/retrieval/rank-fusion.js';
import { retrieveChunks, type RetrieveOptions } from '../../../src/ai/retrieval/retrieve-chunks.js';
import { groupSources } from '../../../src/ai/retrieval/source-groups.js';
import type { RetrievalHit } from '../../../src/index/index-types.js';
import { classifyPath } from '../../../src/markdown/content-classes.js';
import type { SourceReadOptions, SourceText } from '../../../src/sources/source-types.js';
import { createFakeAiRuntime } from '../answers/fake-ai-runtime.js';

const hit = (path: string, page: number | null = null): RetrievalHit => ({
  path,
  title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  class: 'user',
  page,
  score: 1,
});

/** A note whose sections each become one chunk (a heading starts a chunk). */
const sections = (...bodies: string[]) =>
  bodies.map((body, i) => `# Phần ${i + 1}\n\n${body}`).join('\n\n');

function setup(
  files: Record<string, string>,
  hits: RetrievalHit[],
  extra: Partial<RetrieveOptions> = {},
) {
  const reads: string[] = [];
  const pageReads: { path: string; options?: SourceReadOptions }[] = [];
  const options: RetrieveOptions = {
    index: {
      retrieve: () => hits,
      getNote: (path) =>
        files[path] === undefined
          ? null
          : ({ title: path.split('/').pop()!.slice(0, -3) } as never),
    },
    vault: {
      read: async (path) => {
        reads.push(path);
        const content = files[path];
        if (content === undefined) throw new Error('missing');
        return { path, content, revision: 'r', mtimeMs: 0, size: content.length, utf8: true };
      },
    },
    sources: {
      read: async (path, readOptions) => {
        pageReads.push({ path, options: readOptions });
        const from = readOptions?.fromPage ?? 1;
        const to = readOptions?.toPage ?? 1;
        const pages = [];
        for (let page = from; page <= Math.min(to, 9); page += 1) {
          pages.push({ page, text: `Trang ${page}: ma trận và định thức, trị riêng.` });
        }
        return { path, pages, extractionQuality: 'ok' } as SourceText;
      },
    },
    runtime: createFakeAiRuntime(),
    ...extra,
  };
  return { options, reads, pageReads };
}

describe('chunk ranking', () => {
  it('folds terms, drops stop words and ranks passages with BM25', () => {
    expect(queryTerms('Tóm tắt những gì mình học về Đạo hàm')).toEqual([
      'tom',
      'tat',
      'hoc',
      'dao',
      'ham',
    ]);
    const chunks = [
      'Đạo hàm của hàm hợp. Đạo hàm riêng.',
      'Tích phân từng phần.',
      'Một chút đạo hàm.',
    ];
    const ranked = rankBm25(chunks, (c) => c, queryTerms('đạo hàm'));
    expect(ranked.map((r) => r.item)).toEqual([chunks[0], chunks[2]]);
  });

  it('fuses rankings by reciprocal rank (k = 60)', () => {
    const fused = reciprocalRankFusion(
      [
        ['a', 'b', 'c'],
        ['c', 'd', 'a'],
      ],
      (x) => x,
    );
    // a: 1/61 + 1/63, c: 1/63 + 1/61 (tie → first seen), b: 1/62, d: 1/62
    expect(fused).toEqual(['a', 'c', 'b', 'd']);
  });
});

describe('retrieveChunks', () => {
  it('keeps only in-scope candidates (never read) and ranks the passages inside them', async () => {
    const files = {
      '2 Areas/Giải tích.md': sections(
        'Tích phân.',
        'Đạo hàm là tốc độ thay đổi. Đạo hàm của tích.',
        'Giới hạn.',
      ),
      '3 Resources/Bài báo.md': 'Đạo hàm bí mật.',
      '4 Archive/Cũ.md': 'Đạo hàm cũ.',
      'Templates/Mẫu.md': 'Đạo hàm mẫu.',
    };
    const { options, reads } = setup(
      files,
      Object.keys(files).map((p) => hit(p)),
    );
    const result = await retrieveChunks('Tóm tắt những gì mình học về đạo hàm', options);
    expect(reads).toEqual(['2 Areas/Giải tích.md']);
    expect(result.hidden).toBe(3);
    expect(result.mode).toBe('bm25');
    expect(result.chunks.map((c) => c.text)).toEqual([
      '# Phần 2\n\nĐạo hàm là tốc độ thay đổi. Đạo hàm của tích.',
    ]);
  });

  it('counts hidden notes apart from raw sources of 3 Resources (out by default, no news)', async () => {
    const files = {
      '2 Areas/Giải tích.md': 'Đạo hàm.',
      '3 Resources/Bài báo.md': 'Đạo hàm bí mật.',
      '3 Resources/papers/Đạo hàm.pdf': '',
      '4 Archive/Cũ.md': 'Đạo hàm cũ.',
      '1 Projects/Riêng.md': 'Đạo hàm riêng.',
    };
    const hits = Object.keys(files).map((p) => ({ ...hit(p), class: classifyPath(p) }));
    const byDefault = await retrieveChunks('đạo hàm', setup(files, hits).options);
    expect([byDefault.hidden, byDefault.hiddenNotes]).toEqual([3, 1]);
    const ownScope = setup(files, hits, {
      runtime: createFakeAiRuntime({ folders: ['', '2 Areas'] }),
    });
    const left = await retrieveChunks('đạo hàm', ownScope.options);
    expect([left.hidden, left.hiddenNotes]).toEqual([4, 2]);
  });

  it('never uses control docs (CLAUDE.md, wiki index and log) as sources', async () => {
    const files = { 'CLAUDE.md': 'ma trận', 'wiki/index.md': 'ma trận', '2 Areas/A.md': 'ma trận' };
    const hits = Object.keys(files).map((p) => ({
      ...hit(p),
      class: p === '2 Areas/A.md' ? ('user' as const) : ('control' as const),
    }));
    const { options, reads } = setup(files, hits);
    const result = await retrieveChunks('ma trận', options);
    expect(reads).toEqual(['2 Areas/A.md']);
    expect(result.hidden).toBe(0);
  });

  it('caps the result at 12 chunks and 24,000 characters, whole chunks only', async () => {
    const many = sections(...Array.from({ length: 20 }, (_, i) => `ma trận số ${i}`));
    const { options } = setup({ '1 Projects/Nhiều.md': many }, [hit('1 Projects/Nhiều.md')]);
    expect((await retrieveChunks('ma trận', options)).chunks).toHaveLength(12);

    const big = sections(...Array.from({ length: 20 }, () => `ma trận ${'x'.repeat(1700)}`));
    // 12 chunks of the chunker stay under 24,000 characters; a larger count shows the char cap.
    const { options: bigOptions } = setup(
      { '1 Projects/Lớn.md': big },
      [hit('1 Projects/Lớn.md')],
      {
        chunkLimit: 40,
      },
    );
    const chunks = (await retrieveChunks('ma trận', bigOptions)).chunks;
    const total = chunks.reduce((sum, c) => sum + c.text.length, 0);
    expect(total).toBeLessThanOrEqual(24_000);
    expect(chunks.length).toBe(Math.floor(24_000 / chunks[0]!.text.length));
    expect(chunkMarkdown(big).map((c) => c.text)).toEqual(
      expect.arrayContaining(chunks.map((c) => c.text)),
    );
  });

  it('puts up to 3 chunks of the current note first', async () => {
    const files = {
      '0 Inbox/Đang mở.md': sections('Không liên quan một.', 'Không liên quan hai.', 'Ba.', 'Bốn.'),
      '2 Areas/Ma trận.md': sections('ma trận vuông', 'ma trận chéo'),
    };
    const { options } = setup(files, [hit('2 Areas/Ma trận.md')], {
      notePath: '0 Inbox/Đang mở.md',
    });
    const result = await retrieveChunks('ma trận', options);
    expect(result.chunks.map((c) => c.path)).toEqual([
      '0 Inbox/Đang mở.md',
      '0 Inbox/Đang mở.md',
      '0 Inbox/Đang mở.md',
      '2 Areas/Ma trận.md',
      '2 Areas/Ma trận.md',
    ]);
    // A current note outside the scope is not used.
    const { options: hiddenNote } = setup(
      { ...files, '4 Archive/Cũ.md': 'Cũ.' },
      [hit('2 Areas/Ma trận.md')],
      {
        notePath: '4 Archive/Cũ.md',
      },
    );
    expect(
      (await retrieveChunks('ma trận', hiddenNote)).chunks.every(
        (c) => c.path === '2 Areas/Ma trận.md',
      ),
    ).toBe(true);
  });

  it('fuses embedding neighbours (in scope only) with BM25 and says hybrid', async () => {
    const files = {
      '2 Areas/Đại số tuyến tính – chương 3.md': sections(
        'Không gian vectơ.',
        'Định thức và hạng.',
      ),
      '2 Areas/Ma trận.md': sections('ma trận vuông'),
    };
    const embeddingHit = (path: string, index: number, text: string): EmbeddingHit => ({
      path,
      score: 0.9,
      chunk: { index, startLine: 1, endLine: 3, heading: null, text },
    });
    const queries: string[] = [];
    const embeddings: EmbeddingIndex = {
      isReady: () => true,
      query: async (text) => {
        queries.push(text);
        return [
          embeddingHit('4 Archive/Cũ.md', 0, 'ma trận cũ'),
          embeddingHit('2 Areas/Đại số tuyến tính – chương 3.md', 1, 'stale text'),
          embeddingHit('2 Areas/Ma trận.md', 0, 'stale'),
        ];
      },
    };
    const { options } = setup(files, [hit('2 Areas/Ma trận.md')], {
      runtime: createFakeAiRuntime({ embeddings }),
    });
    const result = await retrieveChunks('bài về ma trận', options);
    expect(result.mode).toBe('hybrid');
    expect(queries).toEqual(['bài về ma trận']);
    expect(result.chunks.map((c) => [c.path, c.text])).toEqual([
      // In both rankings: first, with the text just read from disk.
      ['2 Areas/Ma trận.md', '# Phần 1\n\nma trận vuông'],
      ['2 Areas/Đại số tuyến tính – chương 3.md', 'stale text'],
    ]);
  });

  it('falls back to BM25 when the embedding query fails at the provider', async () => {
    const embeddings: EmbeddingIndex = {
      isReady: () => true,
      query: async () => {
        throw new AiError('AI_PROVIDER_ERROR', 'down', { reason: 'server' });
      },
    };
    const { options } = setup({ '2 Areas/Ma trận.md': 'ma trận' }, [hit('2 Areas/Ma trận.md')], {
      runtime: createFakeAiRuntime({ embeddings }),
    });
    const result = await retrieveChunks('ma trận', options);
    expect(result.mode).toBe('bm25');
    expect(result.chunks).toHaveLength(1);
  });

  it('reads PDF pages around the hit page and cites them per page', async () => {
    const { options, pageReads } = setup({}, [hit('3 Resources/papers/Ma trận.pdf', 4)], {
      runtime: createFakeAiRuntime({ folders: ['', '3 Resources'] }),
    });
    const result = await retrieveChunks('định thức ma trận', options);
    expect(pageReads).toEqual([
      { path: '3 Resources/papers/Ma trận.pdf', options: { fromPage: 3, toPage: 5 } },
    ]);
    expect(result.chunks.map((c) => c.page)).toEqual([3, 4, 5]);
    expect(groupSources(result.chunks).map((s) => [s.id, s.page])).toEqual([
      ['S1', 3],
      ['S2', 4],
      ['S3', 5],
    ]);
  });
});
