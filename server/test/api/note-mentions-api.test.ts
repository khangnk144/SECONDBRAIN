import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVaultTestApp, q, type VaultTestApp } from './vault-test-app.js';

const PORT = 4821;
const COURSE = '2 Areas/Giải tích 1.md';
const REVIEW = '0 Inbox/Ôn tập.md';
const PROJECT = '1 Projects/Đồ án.md';
const OLD = '4 Archive/Cũ.md';
const SEED: Record<string, string> = {
  [COURSE]: '# Giải tích 1\n',
  [REVIEW]: 'Hôm nay ôn giải tích 1, `Giải tích 1` và [[Giải tích 1]].\nGiải tích 1 khó.\n',
  [PROJECT]: '---\ncourse: Giải tích 1\n---\nĐồ án môn Giải tích 1.\n',
  [OLD]: 'Giải tích 1 năm ngoái\n',
  'Templates/Mẫu môn.md': 'Giải tích 1\n',
  '3 Resources/web/trang.html': '<p>Giải tích 1</p>',
};

interface Mention {
  path: string;
  title: string;
  revision: string;
  line: number;
  context: string;
  highlight: [number, number];
  start: number;
  end: number;
}

describe('unlinked mentions and "Liên kết" (F5)', () => {
  let t: VaultTestApp;
  const disk = (p: string) => readFileSync(path.join(t.vaultRoot, ...p.split('/')), 'utf8');
  const mentions = async (p = COURSE): Promise<Mention[]> =>
    (await t.call('GET', `/api/note/mentions?${q(p)}`)).json().mentions;
  const link = (m: Mention, extra: object = {}) =>
    t.call('POST', '/api/note/link-mention', {
      path: m.path,
      expectedRevision: m.revision,
      start: m.start,
      end: m.end,
      target: COURSE,
      ...extra,
    });

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, { watcher: false });
    for (const [p, content] of Object.entries(SEED)) {
      if (p.endsWith('.md')) await t.call('POST', '/api/note', { path: p, content });
    }
    // A clipped web page (indexed and searchable, but not a note that could hold a link).
    const html = path.join(t.vaultRoot, '3 Resources', 'web', 'trang.html');
    mkdirSync(path.dirname(html), { recursive: true });
    writeFileSync(html, SEED['3 Resources/web/trang.html']!);
    await t.context.index.reconcile();
  });
  afterAll(async () => t?.close());

  it('lists plain-text mentions in searchable notes, outside code, links and front matter', async () => {
    const found = await mentions();
    expect(found.map((m) => [m.path, m.line, disk(m.path).slice(m.start, m.end)])).toEqual([
      [REVIEW, 1, 'giải tích 1'],
      [REVIEW, 2, 'Giải tích 1'],
      [PROJECT, 4, 'Giải tích 1'],
      [OLD, 1, 'Giải tích 1'],
    ]);
    for (const m of found) {
      expect(m.context.slice(m.highlight[0], m.highlight[1]).toLowerCase()).toBe('giải tích 1');
      expect(m.revision).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(found[0]).toMatchObject({ title: 'Ôn tập', context: SEED[REVIEW]!.split('\n')[0] });
    const res = await t.call('GET', `/api/note/mentions?${q(COURSE)}`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect((await t.call('GET', `/api/note/mentions?${q('0 Inbox/Không có.md')}`)).statusCode).toBe(
      404,
    );
  });

  it('backlinks carry the offsets of the link inside their context', async () => {
    const { backlinks } = (await t.call('GET', `/api/note?${q(COURSE)}`)).json();
    expect(backlinks).toEqual([
      expect.objectContaining({ fromPath: REVIEW, line: 1, highlight: expect.any(Array) }),
    ]);
    const [b] = backlinks;
    expect(b.context.slice(b.highlight[0], b.highlight[1])).toBe('[[Giải tích 1]]');
  });

  it('links exactly one occurrence at the revision and keeps the original text as alias (F5.2)', async () => {
    const [first] = await mentions();
    const before = disk(REVIEW);
    const res = await link(first!);
    expect(res.statusCode, res.body).toBe(200);
    const after = disk(REVIEW);
    expect(after).toBe(
      `${before.slice(0, first!.start)}[[Giải tích 1|giải tích 1]]${before.slice(first!.end)}`,
    );
    expect(res.json()).toEqual({
      revision: (await t.call('GET', `/api/note?${q(REVIEW)}`)).json().revision,
    });
    expect((await mentions()).map((m) => [m.path, m.line])).toEqual([
      [REVIEW, 2],
      [PROJECT, 4],
      [OLD, 1],
    ]);
  });

  it('answers 409 for a stale revision and 400 when the range is not a mention', async () => {
    const [second] = await mentions();
    const before = disk(REVIEW);
    const stale = await link(second!, { expectedRevision: 'b'.repeat(64) });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('CONFLICT');
    const shifted = await link(second!, { start: second!.start + 1 });
    expect(shifted.statusCode).toBe(400);
    expect(shifted.json().error.details.reason).toBe('not-a-mention');
    const otherTitle = await link(second!, { target: OLD });
    expect(otherTitle.json().error.details.reason).toBe('not-a-mention');
    const missing = await link(second!, { target: '2 Areas/Không có.md' });
    expect(missing.statusCode).toBe(404);
    const own = await link({ ...second!, path: COURSE });
    expect(own.json().error.details.reason).toBe('self-link');
    expect(disk(REVIEW)).toBe(before);
  });

  it('writes the path form when the title is not unique in the vault', async () => {
    await t.call('POST', '/api/note', { path: '4 Archive/Giải tích 1.md', content: 'cũ\n' });
    const project = (await mentions()).find((m) => m.path === PROJECT)!;
    const res = await link(project);
    expect(res.statusCode, res.body).toBe(200);
    expect(disk(PROJECT)).toBe(
      '---\ncourse: Giải tích 1\n---\nĐồ án môn [[2 Areas/Giải tích 1|Giải tích 1]].\n',
    );
    const { backlinks } = (await t.call('GET', `/api/note?${q(COURSE)}`)).json();
    expect(backlinks.map((b: { fromPath: string }) => b.fromPath)).toContain(PROJECT);
  });

  it('inside a table row writes the alias separator as \\| so the row keeps its cells', async () => {
    // The title is not unique any more (previous test), so the link needs an alias.
    const TABLE = '0 Inbox/Bảng ôn.md';
    const table = '| Môn | Ghi chú |\n|---|---|\n| Giải tích 1 | ôn thi |\n';
    await t.call('POST', '/api/note', { path: TABLE, content: table });
    const mention = (await mentions()).find((m) => m.path === TABLE)!;
    const res = await link(mention);
    expect(res.statusCode, res.body).toBe(200);
    expect(disk(TABLE)).toBe(
      '| Môn | Ghi chú |\n|---|---|\n| [[2 Areas/Giải tích 1\\|Giải tích 1]] | ôn thi |\n',
    );
    const { backlinks } = (await t.call('GET', `/api/note?${q(COURSE)}`)).json();
    expect(backlinks.map((b: { fromPath: string }) => b.fromPath)).toContain(TABLE);
  });
});
