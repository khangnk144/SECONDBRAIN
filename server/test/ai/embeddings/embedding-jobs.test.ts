import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QUIET_PERIOD_MS } from '../../../src/ai/embeddings/embedding-service.js';
import { FIRST_BYTE_TIMEOUT_MS } from '../../../src/ai/providers/provider-http.js';
import { waitUntil } from '../../api/vault-test-app.js';
import { hangingResponse, jsonResponse, TEST_KEYS } from '../providers/provider-test-kit.js';
import {
  conceptEmbeddingResponder,
  configureAi,
  createAiTestApp,
  sentTexts,
  waitForEmbeddings,
  type AiTestApp,
} from '../runtime/ai-test-kit.js';

const PORT = 47732;
const NOTE = '1 Projects/Đồ án Giải tích.md';
const SECRET_FOLDERS = {
  '3 Resources/papers/Bài báo nguồn.md': 'NGUỒN-KHÔNG-GỬI ma trận',
  '4 Archive/Cũ.md': 'LƯU-TRỮ-KHÔNG-GỬI ma trận',
  'Templates/Mẫu riêng.md': 'MẪU-KHÔNG-GỬI ma trận',
  '2 Areas/Riêng tư.md': 'NGOÀI-PHẠM-VI ma trận',
};

function seed(root: string): void {
  const files: Record<string, string> = {
    [NOTE]: '# Đồ án\n\nTích phân và đạo hàm.\n',
    '1 Projects/Đại số tuyến tính – chương 3.md': '# Chương 3\n\nMa trận và định thức.\n',
    '0 Inbox/Ý tưởng.md': 'Nấu món mới.\n',
    ...SECRET_FOLDERS,
  };
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
}

const storedPaths = (t: AiTestApp): string[] => {
  const db = new Database(path.join(t.context.vault.paths.cacheDir, 'embeddings.sqlite'), {
    readonly: true,
  });
  try {
    return (db.prepare('SELECT path FROM notes ORDER BY path').all() as { path: string }[]).map(
      (row) => row.path,
    );
  } finally {
    db.close();
  }
};

describe('embedding jobs: quiet period, retries, scope (F33.4)', () => {
  let t: AiTestApp;
  let revision: string;

  beforeEach(async () => {
    t = await createAiTestApp(PORT, { seed });
    configureAi(t, { embeddings: true, folders: ['0 Inbox', '1 Projects'] });
    await waitForEmbeddings(t, 'idle');
    revision = (await t.context.vault.read(NOTE)).revision;
  });
  afterEach(async () => t?.close());

  const save = async (text: string) => {
    revision = (await t.context.vault.write(NOTE, text, revision)).revision;
    await t.context.settled();
  };

  it('enabling embeds the in-scope backlog at once; excluded folders are never sent', async () => {
    expect(t.recorder.requests).toHaveLength(1); // 3 small notes, one batch
    expect(t.recorder.requests[0]!.url).toBe('https://api.openai.com/v1/embeddings');
    expect(t.recorder.requests[0]!.body.input).toHaveLength(3);
    expect(storedPaths(t)).toEqual([
      '0 Inbox/Ý tưởng.md',
      '1 Projects/Đại số tuyến tính – chương 3.md',
      NOTE,
    ]);
    const status = t.runtime().status();
    expect(status.retrieval).toBe('hybrid');
    expect(status.embeddings).toMatchObject({ state: 'idle', done: 3, total: 3, pending: 0 });
    expect(t.runtime().embeddings()?.isReady()).toBe(true);
    for (const marker of Object.values(SECRET_FOLDERS))
      expect(sentTexts(t.recorder.requests)).not.toContain(marker.split(' ')[0]);
  });

  it('50 saves within a minute → exactly one request, 5 minutes after the last save', async () => {
    t.recorder.requests.length = 0;
    const note = (i: number) =>
      `# Đồ án\n\nLần lưu ${i}: tích phân.\n\n## Cố định\n\nPhần không đổi.\n`;
    for (let i = 1; i <= 50; i += 1) {
      await save(note(i));
      await t.advance(1_000);
    }
    expect(t.runtime().status().embeddings.pending).toBe(1);
    await t.advance(QUIET_PERIOD_MS - 2_000);
    expect(t.recorder.requests).toHaveLength(0);
    await t.advance(2_000);
    await waitUntil(() => (t.recorder.requests.length === 1 ? true : undefined));
    await waitForEmbeddings(t, 'idle');
    await t.advance(QUIET_PERIOD_MS * 3);
    expect(t.recorder.requests).toHaveLength(1);
    expect(t.recorder.requests[0]!.body.input).toEqual([
      'Đồ án Giải tích – Đồ án\n\n# Đồ án\n\nLần lưu 50: tích phân.',
      'Đồ án Giải tích – Cố định\n\n## Cố định\n\nPhần không đổi.',
    ]);
    // One more save that changes only the first section: the unchanged chunk keeps its vector.
    await save(note(51));
    await t.advance(QUIET_PERIOD_MS);
    await waitUntil(() => (t.recorder.requests.length === 2 ? true : undefined));
    expect(t.recorder.requests[1]!.body.input).toEqual([
      'Đồ án Giải tích – Đồ án\n\n# Đồ án\n\nLần lưu 51: tích phân.',
    ]);
  });

  it('429 → retried after 1 min, then 5 min; saves are unaffected', async () => {
    t.recorder.requests.length = 0;
    t.recorder.respondWith(() => jsonResponse({ error: { message: 'slow down' } }, 429));
    await save('# Đồ án\n\nThay đổi.\n');
    await t.advance(QUIET_PERIOD_MS);
    await waitForEmbeddings(t, 'queued');
    expect(t.runtime().status().embeddings).toMatchObject({ lastError: 'rate-limit', pending: 1 });
    expect(t.recorder.requests).toHaveLength(1);
    await t.advance(59_000);
    expect(t.recorder.requests).toHaveLength(1);
    await t.advance(1_000);
    await waitUntil(() => (t.recorder.requests.length === 2 ? true : undefined));
    await waitForEmbeddings(t, 'queued');
    await t.advance(4 * 60_000);
    expect(t.recorder.requests).toHaveLength(2);
    t.recorder.respondWith(conceptEmbeddingResponder);
    await t.advance(60_000);
    await waitForEmbeddings(t, 'idle');
    expect(t.recorder.requests).toHaveLength(3);
    expect(t.runtime().status().embeddings.lastError).toBeNull();
  });

  it('a hanging provider never blocks a save; it times out after 30 s and is retried', async () => {
    t.recorder.requests.length = 0;
    t.recorder.respondWith(hangingResponse);
    await save('# Đồ án\n\nTreo.\n');
    await t.advance(QUIET_PERIOD_MS);
    await waitUntil(() => (t.recorder.requests.length === 1 ? true : undefined));
    expect(t.runtime().status().embeddings.state).toBe('running');
    const started = Date.now();
    const res = await t.call('PUT', '/api/note', {
      path: NOTE,
      content: '# Đồ án\n\nLưu trong lúc chờ.\n',
      expectedRevision: revision,
    });
    expect(res.statusCode).toBe(200);
    expect(Date.now() - started).toBeLessThan(1000);
    revision = res.json().revision;
    await t.advance(FIRST_BYTE_TIMEOUT_MS);
    await waitForEmbeddings(t, 'queued');
    expect(t.runtime().status().embeddings.lastError).toBe('timeout');
    t.recorder.respondWith(conceptEmbeddingResponder);
    await t.advance(QUIET_PERIOD_MS); // the retry (1 min) and the new save's quiet period
    await waitForEmbeddings(t, 'idle');
    expect(sentTexts(t.recorder.requests)).toContain('Lưu trong lúc chờ.');
  });

  it('auth failure stops the jobs (state error) until the settings change', async () => {
    t.recorder.requests.length = 0;
    t.recorder.respondWith(() => jsonResponse({ error: {} }, 401));
    await save('# Đồ án\n\nKhóa sai.\n');
    await t.advance(QUIET_PERIOD_MS);
    await waitForEmbeddings(t, 'error');
    expect(t.runtime().status().embeddings.lastError).toBe('auth');
    await t.advance(10 * 60 * 60_000);
    expect(t.recorder.requests).toHaveLength(1);
    t.recorder.respondWith(conceptEmbeddingResponder);
    t.runtime().settingsChanged?.(); // e.g. a new key was saved
    await waitForEmbeddings(t, 'idle');
    expect(t.recorder.requests).toHaveLength(2);
    // The log names outcomes only: no key, note text, title or path.
    const log = t.logger.lines.join('\n');
    expect(log).toMatch(/AI embed openai: AI_PROVIDER_ERROR:auth, 0 tokens/);
    expect(log).toContain('Embeddings stopped (auth)');
    for (const secret of [...Object.values(TEST_KEYS), 'Khóa sai', 'Đồ án Giải tích', 'Tích phân'])
      expect(log).not.toContain(secret);
  });

  it('narrowing the scope removes rows; deleting removes, moving keeps vectors', async () => {
    t.settings.ai.folders = ['1 Projects'];
    t.runtime().settingsChanged?.();
    await waitForEmbeddings(t, 'idle');
    expect(storedPaths(t)).toEqual(['1 Projects/Đại số tuyến tính – chương 3.md', NOTE]);
    t.recorder.requests.length = 0;
    const moved = '1 Projects/Lưu/Đồ án Giải tích.md';
    await t.context.vault.createFolder('1 Projects/Lưu');
    await t.context.vault.move(NOTE, '1 Projects/Lưu', {
      expectedRevision: revision,
      relink: false,
    });
    await t.context.settled();
    await t.advance(QUIET_PERIOD_MS);
    await waitForEmbeddings(t, 'idle');
    expect(storedPaths(t)).toContain(moved);
    expect(t.recorder.requests).toHaveLength(0); // same title and text: vectors reused
    const chapter = '1 Projects/Đại số tuyến tính – chương 3.md';
    const { revision: rev } = await t.context.vault.read(chapter);
    await t.context.vault.trash([chapter], [rev]);
    await t.context.settled();
    expect(storedPaths(t)).toEqual([moved]);
  });
});
