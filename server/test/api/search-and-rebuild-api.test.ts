import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { TEST_TOKEN } from '../helpers/test-environment.js';
import { createVaultTestApp, waitUntil, type VaultTestApp } from './vault-test-app.js';

const PORT = 4796;
const FILLER_NOTES = 1500;

function seed(root: string): void {
  const write = (relative: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), content);
  };
  write('2 Areas/Giải tích 1.md', '# Giải tích 1\n\nGiới hạn, đạo hàm, tích phân.\n');
  write('2 Areas/Đại số tuyến tính.md', '# Đại số tuyến tính\n\nMa trận và định thức.\n');
  write('1 Projects/Đồ án cuối kỳ.md', '---\ntype: project\n---\nBáo cáo về [[Giải tích 1]].\n');
  // NFD name, as copied from a Mac.
  write('0 Inbox/Ghi chép xác suất.md'.normalize('NFD'), 'Biến cố độc lập.\n');
  // Enough notes that a rebuild takes a moment, so requests can arrive while it runs.
  for (let i = 0; i < FILLER_NOTES; i += 1) {
    write(
      `4 Archive/lô ${Math.floor(i / 100)}/ghi chú ${i}.md`,
      `# Ghi chú ${i}\n\nnội dung số ${i} #lưu-trữ\n`,
    );
  }
}

describe('search through the API (F8.2) and rebuild with progress (F8.5)', () => {
  let t: VaultTestApp;
  beforeAll(async () => {
    t = await createVaultTestApp(PORT, { listen: true, watcher: false, seed });
  }, 60_000);
  afterAll(async () => t?.close());

  const search = async (text: string) => {
    const res = await t.call('GET', `/api/search?q=${encodeURIComponent(text)}`);
    expect(res.statusCode, `${text}: ${res.body}`).toBe(200);
    return res.json().results as {
      path: string;
      title: string;
      matchedIn: string;
      snippet: unknown;
    }[];
  };

  it.each([
    ['giai tich', 'Giải tích 1'],
    ['dai so', 'Đại số tuyến tính'],
    ['do an', 'Đồ án cuối kỳ'],
    ['xac suat', 'Ghi chép xác suất'],
  ])('"%s" finds "%s" (title first)', async (query, title) => {
    const results = await search(query);
    expect(results[0]).toMatchObject({ title, matchedIn: 'title' });
  });

  it('treats NFD and NFC queries the same and never errors on FTS syntax', async () => {
    expect(await search('Giải tích'.normalize('NFD'))).toEqual(
      await search('Giải tích'.normalize('NFC')),
    );
    for (const query of [
      '"',
      '*',
      '-',
      '(',
      'a"b',
      'NEAR(',
      'tích*',
      '-đạo',
      'AND OR NOT',
      ':',
      'tag:',
    ]) {
      await search(query);
    }
  });

  it('answers an empty query with recent notes and validates filters', async () => {
    const recent = await search('');
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every((result) => result.matchedIn === 'recent')).toBe(true);
    expect((await t.call('GET', '/api/search?q=x&due=tomorrow')).json().error.code).toBe(
      'VALIDATION',
    );
  });

  it('rebuilds in the background: 409 while running, searches served meanwhile, progress over WS', async () => {
    const before = await search('giai tich');
    const progress: { phase: string; done: number; total: number }[] = [];
    const socket = new WebSocket(`ws://localhost:${PORT}/ws?token=${TEST_TOKEN}`);
    socket.on('message', (data) => {
      const event = JSON.parse(String(data));
      if (event.type === 'index:progress') progress.push(event);
    });
    await new Promise((resolve) => socket.once('open', resolve));

    const started = await t.call('POST', '/api/index/rebuild');
    expect(started.statusCode).toBe(202);
    expect(started.json()).toEqual({ started: true });
    const second = await t.call('POST', '/api/index/rebuild');
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('CONFLICT');
    expect((await search('dai so'))[0]?.title).toBe('Đại số tuyến tính');

    await waitUntil(() => progress.find((event) => event.phase === 'done'), 30_000);
    socket.close();
    expect(progress.some((event) => event.phase === 'index' && event.total >= FILLER_NOTES)).toBe(
      true,
    );
    expect(await search('giai tich')).toEqual(before);
    expect((await t.call('POST', '/api/index/rebuild')).statusCode).toBe(202);
    await waitUntil(() => (t.context.index.isRebuilding() ? undefined : true), 30_000);
  }, 60_000);
});
