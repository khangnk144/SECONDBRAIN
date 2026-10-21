import { describe, expect, it } from 'vitest';
import type { EmbeddingHit, EmbeddingIndex } from '../../../src/ai/ai-types.js';
import {
  MIN_VECTOR_SCORE,
  plainChunkText,
  semanticSearch,
} from '../../../src/ai/retrieval/semantic-search.js';
import type { RetrieveOptions } from '../../../src/ai/retrieval/retrieve-chunks.js';
import type { RetrievalHit } from '../../../src/index/index-types.js';
import { classifyPath } from '../../../src/markdown/content-classes.js';
import { createFakeAiRuntime } from '../answers/fake-ai-runtime.js';

const FILES: Record<string, string> = {
  '2 Areas/Đại số tuyến tính – chương 3.md':
    '# Đại số tuyến tính – chương 3\n\n- [ ] **Định thức** của _bảng số_ [[Ma trận|vuông]], [[Hạng]] và `det`.\n',
  '1 Projects/Kế hoạch tuần.md': '# Kế hoạch tuần\n\nĐi thư viện, gặp nhóm đồ án.\n',
  '2 Areas/Ma trận.md': '## Ma trận\n\nMa trận nghịch đảo.\n',
};

const hit = (path: string): RetrievalHit => ({
  path,
  title: path.slice(path.lastIndexOf('/') + 1, -3),
  class: classifyPath(path),
  page: null,
  score: 1,
});

const vector = (path: string, score: number): EmbeddingHit => ({
  path,
  score,
  chunk: { index: 0, startLine: 1, endLine: 3, heading: null, text: FILES[path]!.trim() },
});

function options(bm25: RetrievalHit[], vectors: EmbeddingHit[]): Omit<RetrieveOptions, 'notePath'> {
  const embeddings: EmbeddingIndex = { isReady: () => true, query: async () => vectors };
  return {
    index: {
      retrieve: () => bm25,
      getNote: (path) => (FILES[path] === undefined ? null : (hit(path) as never)),
    },
    vault: {
      read: async (path) => {
        const content = FILES[path]!;
        return { path, content, revision: 'r', mtimeMs: 0, size: content.length, utf8: true };
      },
    },
    sources: null,
    runtime: createFakeAiRuntime({ embeddings }),
  };
}

describe('meaning search: relevance floor and plain-text snippets (F33.3)', () => {
  it('lists a vector hit only from cosine 0.25 on; keyword hits whatever their vector score', async () => {
    expect(MIN_VECTOR_SCORE).toBe(0.25);
    const result = await semanticSearch(
      'bài về ma trận',
      10,
      options(
        [hit('2 Areas/Ma trận.md')],
        [
          vector('2 Areas/Đại số tuyến tính – chương 3.md', 0.82),
          vector('1 Projects/Kế hoạch tuần.md', 0.24),
          vector('2 Areas/Ma trận.md', 0.1),
        ],
      ),
    );
    expect(result.mode).toBe('hybrid');
    expect(result.results.map((r) => r.path).sort()).toEqual([
      '2 Areas/Ma trận.md',
      '2 Areas/Đại số tuyến tính – chương 3.md',
    ]);

    // Nothing near enough: the meaning group stays empty (still a hybrid search).
    const none = await semanticSearch(
      'thời tiết',
      10,
      options([], [vector('1 Projects/Kế hoạch tuần.md', 0.12)]),
    );
    expect(none).toEqual({ mode: 'hybrid', results: [] });
  });

  it('snippets carry no Markdown: headings, emphasis, task markers, links, code ticks', async () => {
    const result = await semanticSearch(
      'bài về ma trận',
      10,
      options([], [vector('2 Areas/Đại số tuyến tính – chương 3.md', 0.82)]),
    );
    expect(result.results[0]!.snippet).toBe(
      'Đại số tuyến tính – chương 3 Định thức của bảng số vuông, Hạng và det.',
    );
    expect(plainChunkText('2 Areas/A.md', '## Phần *một*\n\n1. [[a]] ~~b~~')).toBe('Phần một\na b');
    // PDF page text is already plain: kept as is.
    expect(plainChunkText('3 Resources/x.pdf', '# 1 * 2')).toBe('# 1 * 2');
  });
});
