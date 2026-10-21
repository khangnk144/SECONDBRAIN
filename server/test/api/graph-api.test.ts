import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVaultTestApp, q, type VaultTestApp } from './vault-test-app.js';

const PORT = 4844;
const P = '1 Projects/Đồ án Giải tích.md';
const GT = '2 Areas/Giải tích 1.md';
const PDF = '3 Resources/papers/bài giảng 3.pdf';
const IMG = 'Attachments/ảnh.png';
const DAILY = 'Daily/2026-10-20.md';
const WIKI = 'wiki/concepts/Đạo hàm.md';
const OLD = '4 Archive/Đồ án cũ.md';

const FILES: Record<string, string> = {
  [P]: '# Đồ án\n[[Giải tích 1]] [[bài giảng 3.pdf]] [[Ghost]] [[Ghi chú]] [[#Đồ án]] [[Đồ án Giải tích]]\n',
  [GT]: 'Môn học cho [[Đồ án Giải tích]] và [[Đạo hàm]].\n',
  [OLD]: '[GT1](../2%20Areas/Gi%E1%BA%A3i%20t%C3%ADch%201.md)\n',
  [WIKI]: '---\ntype: wiki\n---\nĐạo hàm là…\n',
  [DAILY]: '- [ ] Làm [[Đồ án Giải tích]]\n![[ảnh.png]]\n',
  '0 Inbox/Ghi chú.md': 'Hai ghi chú cùng tên.\n',
  '2 Areas/Ghi chú.md': 'Hai ghi chú cùng tên.\n',
  '0 Inbox/Mồ côi.md': 'Không liên kết, chỉ `[[Giải tích 1]]` trong code.\n',
  'Templates/Mẫu.md': '[[Giải tích 1]]\n',
  'CLAUDE.md': '[[Giải tích 1]]\n',
  'wiki/index.md': '[[Đạo hàm]]\n',
  '3 Resources/web/Bài viết.md': '[[Giải tích 1]]\n',
  '3 Resources/papers/không ai liên kết.pdf': '%PDF-1.4\n',
  [PDF]: '%PDF-1.4\n',
  [IMG]: 'png',
};

const EDGES = [
  { source: P, target: GT },
  { source: P, target: PDF },
  { source: GT, target: WIKI },
  { source: OLD, target: GT },
  { source: DAILY, target: P },
  { source: DAILY, target: IMG },
];

interface Node {
  id: string;
  kind: string;
  class: string;
  group: string;
  degree: number;
  orphan: boolean;
}

describe('brain graph API (F16.2, F16.6)', () => {
  let t: VaultTestApp;
  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      seed: (root) => {
        for (const [p, content] of Object.entries(FILES)) {
          mkdirSync(path.dirname(path.join(root, ...p.split('/'))), { recursive: true });
          writeFileSync(path.join(root, ...p.split('/')), content);
        }
      },
    });
  });
  afterAll(async () => t?.close());

  it('draws user, archived and wiki notes plus linked sources; resolved links only', async () => {
    const res = await t.call('GET', '/api/graph');
    expect(res.statusCode).toBe(200);
    const { nodes, edges } = res.json() as { nodes: Node[]; edges: typeof EDGES };
    const summary = Object.fromEntries(
      nodes.map((n) => [n.id, [n.kind, n.class, n.group, n.degree, n.orphan]]),
    );
    expect(summary).toEqual({
      '0 Inbox/Ghi chú.md': ['note', 'user', 'other', 0, true],
      '0 Inbox/Mồ côi.md': ['note', 'user', 'other', 0, true],
      [P]: ['note', 'user', 'projects', 3, false],
      '2 Areas/Ghi chú.md': ['note', 'user', 'areas', 0, true],
      [GT]: ['note', 'user', 'areas', 3, false],
      [PDF]: ['source', 'source', 'resources', 1, false],
      [OLD]: ['note', 'archived', 'other', 1, false],
      [IMG]: ['source', 'attachment', 'other', 1, false],
      [DAILY]: ['note', 'user', 'daily', 2, false],
      [WIKI]: ['note', 'wiki', 'wiki', 1, false],
    });
    expect(nodes.map((n) => n.id)).toEqual(Object.keys(summary).sort());
    expect(nodes.find((n) => n.id === PDF)).toMatchObject({ title: 'bài giảng 3.pdf' });
    expect(nodes.find((n) => n.id === P)).toMatchObject({ title: 'Đồ án Giải tích' });
    expect([...edges].sort((a, b) => (a.source + a.target < b.source + b.target ? -1 : 1))).toEqual(
      [...EDGES].sort((a, b) => (a.source + a.target < b.source + b.target ? -1 : 1)),
    );
  });

  it('local graph: depth 1 is exactly the neighbours, depth 2 one hop further', async () => {
    const local = async (p: string, depth?: number) =>
      (await t.call('GET', `/api/graph/local?${q(p)}${depth ? `&depth=${depth}` : ''}`)).json();
    const one = await local(P);
    expect(one.nodes.map((n: Node) => n.id).sort()).toEqual([P, GT, PDF, DAILY].sort());
    expect(one.edges).toHaveLength(3);
    expect(one.nodes.find((n: Node) => n.id === GT).degree).toBe(3);
    const two = await local(P, 2);
    expect(two.nodes.map((n: Node) => n.id).sort()).toEqual(
      [P, GT, PDF, DAILY, WIKI, OLD, IMG].sort(),
    );
    expect(two.edges).toHaveLength(EDGES.length);
    expect((await local('0 Inbox/Mồ côi.md', 2)).nodes.map((n: Node) => n.id)).toEqual([
      '0 Inbox/Mồ côi.md',
    ]);
  });

  it('a note that is not drawn has an empty local graph; an unknown note is 404', async () => {
    for (const p of ['Templates/Mẫu.md', 'CLAUDE.md', '3 Resources/web/Bài viết.md']) {
      const res = await t.call('GET', `/api/graph/local?${q(p)}`);
      expect(res.json(), p).toEqual({ nodes: [], edges: [] });
    }
    const missing = await t.call('GET', `/api/graph/local?${q('0 Inbox/Không có.md')}`);
    expect(missing.statusCode).toBe(404);
    const depth = await t.call('GET', `/api/graph/local?${q(P)}&depth=3`);
    expect(depth.statusCode).toBe(400);
  });
});
