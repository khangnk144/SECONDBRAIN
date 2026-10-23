import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { graphFilterMatches, type GraphFilter } from '../../src/graph/graph-filter.js';
import { createVaultTestApp, type VaultTestApp } from './vault-test-app.js';

const PORT = 47851;
const NOW = new Date(2026, 9, 22, 15, 0);
const DAY = 86_400_000;

const PROJECT = '1 Projects/Đồ án Giải tích.md';
const COURSE = '2 Areas/Giải tích 1.md';
const DAILY = 'Daily/2026-10-22.md';
const OLD = '0 Inbox/Ghi chú cũ.md';
const PDF = '3 Resources/papers/bài giảng 3.pdf';

/** Content and how many days ago the file was last modified. */
const FILES: Record<string, [string, number]> = {
  // NFD spelling of the tag in the file: the index stores it NFC.
  [PROJECT]: [
    `#${'đồ-án'.normalize('NFD')} #môn/giải-tích\n[[Giải tích 1]] [[bài giảng 3.pdf]]\n`,
    3,
  ],
  [COURSE]: ['---\ntags: [Môn]\n---\nMôn học.\n', 20],
  [DAILY]: ['Hôm nay học [[Giải tích 1]]\n', 0],
  [OLD]: ['#Đồ-Án cũ\n', 45],
  [PDF]: ['%PDF-1.4\n', 60],
};

interface Body {
  nodes: { id: string; kind: 'note' | 'source'; group: string; tags: string[]; mtimeMs?: number }[];
  matches?: string[];
}

describe('GET /api/graph filters (F24.2)', () => {
  let t: VaultTestApp;
  const get = async (query: string) => {
    const res = await t.call('GET', `/api/graph${query}`);
    expect(res.statusCode, query).toBe(200);
    return res.json() as Body;
  };

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      now: () => NOW,
      seed: (root) => {
        for (const [p, [content, daysAgo]] of Object.entries(FILES)) {
          const file = path.join(root, ...p.split('/'));
          mkdirSync(path.dirname(file), { recursive: true });
          writeFileSync(file, content);
          const when = new Date(NOW.getTime() - daysAgo * DAY - 3600_000);
          utimesSync(file, when, when);
        }
      },
    });
  });
  afterAll(async () => t?.close());

  it('(F24.2) every node carries its filter facts; no filter → no matches list', async () => {
    const body = await get('');
    expect(body.matches).toBeUndefined();
    const project = body.nodes.find((n) => n.id === PROJECT);
    expect(project?.tags.sort()).toEqual(['dồ-án', 'môn/giải-tích']);
    expect(project?.mtimeMs).toBe(NOW.getTime() - 3 * DAY - 3600_000);
    expect(body.nodes.find((n) => n.id === COURSE)?.tags).toEqual(['môn']);
    expect(body.nodes.find((n) => n.id === PDF)).toMatchObject({ kind: 'source', tags: [] });
  });

  it('(F24.2) folder (repeated or comma list), group, tag (any spelling, nested) and since', async () => {
    const ids = async (query: string) => (await get(query)).matches?.sort();
    expect(await ids('?folder=1%20Projects')).toEqual([PROJECT]);
    expect(await ids('?folder=daily&folder=0%20INBOX')).toEqual([OLD, DAILY].sort());
    expect(await ids('?folder=Daily,2%20Areas')).toEqual([COURSE, DAILY].sort());
    expect(await ids('?group=resources')).toEqual([PDF]);
    expect(await ids(`?tag=${encodeURIComponent('#ĐỒ-ÁN'.normalize('NFD'))}`)).toEqual(
      [OLD, PROJECT].sort(),
    );
    expect(await ids(`?tag=${encodeURIComponent('môn')}`)).toEqual([COURSE, PROJECT].sort());
    expect(await ids('?since=2026-10-16')).toEqual([DAILY, PROJECT].sort());
    expect(await ids('?since=2026-10-22')).toEqual([DAILY]);
    expect(
      await ids(`?folder=1%20Projects&tag=${encodeURIComponent('môn')}&since=2026-10-22`),
    ).toEqual([]);
  });

  it('(F24.2) the API and the shared predicate agree on the same nodes', async () => {
    const all = await get('');
    const filter: GraphFilter = {
      folders: [],
      groups: ['projects', 'daily'],
      tag: null,
      since: new Date(2026, 9, 16).getTime(),
    };
    const api = await get('?group=projects&group=daily&since=2026-10-16');
    expect(api.matches).toEqual(graphFilterMatches(filter, all.nodes));
  });

  it('(F24.2) a bad since or group is a 400', async () => {
    expect((await t.call('GET', '/api/graph?since=h%C3%B4m%20qua')).statusCode).toBe(400);
    expect((await t.call('GET', '/api/graph?group=planets')).statusCode).toBe(400);
  });
});
