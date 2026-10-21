import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configureAi,
  createAiTestApp,
  waitForEmbeddings,
  type AiTestApp,
} from '../runtime/ai-test-kit.js';

const PORT = 47734;
const TARGET = '2 Areas/Đại số tuyến tính – chương 3.md';
const NOTES: Record<string, string> = {
  [TARGET]: '# Không gian con\n\nCơ sở, số chiều và phép biến đổi.\n',
  '2 Areas/Xác suất thống kê – chương 1.md': '# Biến ngẫu nhiên\n\nPhân phối chuẩn.\n',
  '2 Areas/Giải tích 1.md': '# Đạo hàm\n\nTích phân xác định.\n',
  '0 Inbox/Món ăn cuối tuần.md': 'Công thức nấu phở bò.\n',
  '0 Inbox/Lịch sử Việt Nam.md': 'Các triều đại phong kiến.\n',
  '1 Projects/Câu lạc bộ bóng đá.md': 'Lịch trận đấu tháng 11.\n',
  '4 Archive/Ma trận cũ.md': 'Ma trận và định thức (lưu trữ, không được gửi).\n',
};

describe('semantic ranking with a deterministic embedding model (F33.3)', () => {
  let t: AiTestApp;

  beforeAll(async () => {
    t = await createAiTestApp(PORT, {
      seed: (root) => {
        for (const [file, content] of Object.entries(NOTES)) {
          mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
          writeFileSync(path.join(root, file), content);
        }
      },
    });
  });
  afterAll(async () => t?.close());

  it('with embeddings off there is no index and retrieval says bm25', () => {
    expect(t.runtime().embeddings()).toBeNull();
    expect(t.runtime().status().retrieval).toBe('bm25');
  });

  it('"bài về ma trận" ranks "Đại số tuyến tính – chương 3" in the top 3, in scope only', async () => {
    configureAi(t, { embeddings: true });
    await waitForEmbeddings(t, 'idle');
    expect(t.runtime().status().retrieval).toBe('hybrid');
    const index = t.runtime().embeddings();
    expect(index?.isReady()).toBe(true);
    const hits = await index!.query('bài về ma trận', 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.slice(0, 3).map((hit) => hit.path)).toContain(TARGET);
    expect(hits[0]).toMatchObject({
      path: TARGET,
      chunk: { index: 0, startLine: 1, endLine: 3, heading: 'Không gian con' },
    });
    expect(hits[0]!.chunk.text).toBe('# Không gian con\n\nCơ sở, số chiều và phép biến đổi.');
    expect(hits[0]!.score).toBeGreaterThan(0.9);
    expect(hits.every((hit) => !hit.path.startsWith('4 Archive/'))).toBe(true);
    const sorted = [...hits].sort((a, b) => b.score - a.score);
    expect(hits).toEqual(sorted);
  });

  it('a hit whose note changed since it was embedded is dropped, not misquoted', async () => {
    const note = await t.context.vault.read(TARGET);
    // Written outside the event flow (no job yet): the stored vector is for the old text.
    await t.context.vault.write(TARGET, '# Khác hẳn\n\nNội dung mới.\n', note.revision);
    const hits = await t.runtime().embeddings()!.query('ma trận', 5);
    expect(hits.map((hit) => hit.path)).not.toContain(TARGET);
  });
});
