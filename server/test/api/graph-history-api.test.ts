import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GraphHistory } from '../../src/graph/graph-history.js';
import {
  CONCEPT,
  COURSE,
  DAILY,
  edgeKey,
  EXPECTED_WEEKS,
  FIXTURE_LOG,
  IDEA,
  NOW,
  PDF,
  PROJECT,
  TEMPLATE,
  WEEKS,
} from '../graph/graph-history-fixture.js';
import { createVaultTestApp, type VaultTestApp } from './vault-test-app.js';

const PORT = 47850;

/** The notes of the fixture's live index, with the links it lists. */
const FILES: Record<string, string> = {
  [IDEA]: 'Ý tưởng: [[Đạo hàm]]\n',
  [COURSE]: '# Giải tích 1\n',
  [CONCEPT]: '---\ntype: wiki\n---\nĐạo hàm là giới hạn.\n',
  [PROJECT]: 'Môn [[Giải tích 1]]\n',
  [DAILY]: '- [ ] Làm [[Đồ án Giải tích]]\n',
  [TEMPLATE]: '[[Giải tích 1]]\n',
  [PDF]: '%PDF-1.4\n',
};

function existingAt(history: GraphHistory, instant: number) {
  const covers = (from: number, to?: number) =>
    from < instant && (to === undefined || to >= instant);
  const nodes = history.nodes.filter((n) => covers(n.firstSeen, n.removedAt)).map((n) => n.id);
  const edges = history.edges
    .filter((e) => covers(e.addedAt, e.removedAt))
    .map((e) => edgeKey(e.from, e.to));
  return { nodes: [...new Set(nodes)].sort(), edges: [...new Set(edges)].sort() };
}

const weekEnd = (monday: string) => {
  const [y, m, d] = monday.split('-').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, (d ?? 1) + 7).getTime();
};

describe('GET /api/graph/history (F24.1)', () => {
  let t: VaultTestApp;
  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      now: () => NOW,
      seed: (root) => {
        for (const [p, content] of Object.entries(FILES)) {
          const file = path.join(root, ...p.split('/'));
          mkdirSync(path.dirname(file), { recursive: true });
          writeFileSync(file, content);
        }
        // The vault was indexed before: its log already holds six weeks of history.
        const log = path.join(root, '.secondbrain', 'state', 'events.jsonl');
        mkdirSync(path.dirname(log), { recursive: true });
        writeFileSync(log, `${FIXTURE_LOG.join('\n')}\n`);
      },
    });
  });
  afterAll(async () => t?.close());

  it('(F24.1) week by week, exactly the nodes and edges of the fixture log', async () => {
    const res = await t.call('GET', '/api/graph/history');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const history = res.json() as GraphHistory;
    expect(history).toMatchObject({ firstWeek: WEEKS[0], currentWeek: WEEKS[5] });
    WEEKS.forEach((monday, w) => {
      expect(existingAt(history, weekEnd(monday)), `week of ${monday}`).toEqual(EXPECTED_WEEKS[w]);
    });
  });

  it('(F24.1) the current week is the live map', async () => {
    const graph = (await t.call('GET', '/api/graph')).json() as {
      nodes: { id: string }[];
      edges: { source: string; target: string }[];
    };
    const history = (await t.call('GET', '/api/graph/history')).json() as GraphHistory;
    const now = existingAt(history, NOW.getTime() + 1);
    expect(now.nodes).toEqual(graph.nodes.map((n) => n.id).sort());
    expect(now.edges).toEqual(graph.edges.map((e) => edgeKey(e.source, e.target)).sort());
  });

  it('(F24.1) a note created now joins the history at once; GET changes nothing', async () => {
    const log = t.context.vault.paths.eventsFile;
    const before = readFileSync(log, 'utf8');
    await t.call('GET', '/api/graph/history');
    expect(readFileSync(log, 'utf8')).toBe(before);

    const created = await t.call('POST', '/api/note', {
      path: '0 Inbox/Ghi chú mới.md',
      content: 'Nối [[Đạo hàm]]\n',
    });
    expect(created.statusCode).toBe(201);
    await t.context.settled();
    const history = (await t.call('GET', '/api/graph/history')).json() as GraphHistory;
    expect(history.nodes.find((n) => n.id === '0 Inbox/Ghi chú mới.md')).toMatchObject({
      kind: 'note',
      firstSeen: NOW.getTime(),
    });
    expect(
      history.edges.find((e) => e.from === '0 Inbox/Ghi chú mới.md' && e.to === CONCEPT),
    ).toMatchObject({ addedAt: NOW.getTime() });
    // The pulse and the "today" filter read the creation instant from the same log.
    const graph = (await t.call('GET', '/api/graph')).json() as {
      nodes: { id: string; createdMs?: number }[];
    };
    expect(graph.nodes.find((n) => n.id === '0 Inbox/Ghi chú mới.md')?.createdMs).toBe(
      NOW.getTime(),
    );
  });

  it('(F24.1) needs the session token', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/graph/history',
      headers: { host: `localhost:${PORT}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
