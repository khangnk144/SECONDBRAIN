import { createHash } from 'node:crypto';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '../../src/app-context/create-app-context.js';
import { capLists } from '../../src/mcp/bounded-results.js';
import { KeyedLock } from '../../src/mcp/keyed-lock.js';
import { wikiLint } from '../../src/mcp/wiki-lint.js';
import { createVaultTestApp, type VaultTestApp } from '../api/vault-test-app.js';
import {
  connectTestClient,
  fakeSourceId,
  fakeSourcesPlugin,
  type McpTestClient,
} from './mcp-test-kit.js';

const PORT = 47725;
const A_PDF = '3 Resources/papers/a.pdf';
const C_PDF = '3 Resources/papers/c.pdf';
const C_BYTES = '%PDF c';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('wiki_lint structural report (F32)', () => {
  let t: VaultTestApp;
  let mcp: McpTestClient;
  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      plugins: [fakeSourcesPlugin(new Map())],
      seed: (root) => {
        const write = (p: string, text: string) => {
          mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
          writeFileSync(path.join(root, p), text);
        };
        write(A_PDF, '%PDF a');
        write(C_PDF, C_BYTES);
        write(
          'wiki/index.md',
          '# Mục lục\n\n- [[wiki/papers/A]]\n- [[wiki/papers/C]]\n- [[wiki/concepts/Orphan]]\n- [[wiki/papers/Gone]]\n',
        );
        write(
          'wiki/papers/A.md',
          `---\ntype: wiki\nsource: ${A_PDF}\nsource_hash: ${'0'.repeat(64)}\n---\n\n[[wiki/concepts/B]]\n\n[[Khái niệm X]]\n`,
        );
        write(
          'wiki/papers/C.md',
          `---\ntype: wiki\nsource: ${C_PDF}\nsource_hash: ${sha(C_BYTES)}\n---\n\n[[Khái niệm X]]\n\n[[khái niệm x]] và [[wiki/papers/A]]\n`,
        );
        write('wiki/concepts/B.md', '# B\n\n[[wiki/papers/C]]\n');
        write('wiki/concepts/Orphan.md', '# Không ai trỏ tới\n');
        write('wiki/concepts/Cũ.md', '# Cũ\n');
        const old = new Date(Date.now() - 100 * 24 * 3600_000);
        utimesSync(path.join(root, 'wiki/concepts/Cũ.md'), old, old);
        const ingest = path.join(root, '.secondbrain', 'state', 'ingest');
        mkdirSync(ingest, { recursive: true });
        const id = fakeSourceId(C_PDF);
        const run = {
          runId: `${id}.01JAAAAAAAAAAAAAAAAAAAAAAA`,
          contentHash: sha(C_BYTES),
          startedAt: '2026-10-20T01:00:00.000Z',
          finishedAt: '2026-10-20T01:10:00.000Z',
          status: 'succeeded',
          outputs: ['wiki/papers/C.md'],
          logLine: '## [2026-10-20] ingest | c',
          reason: null,
        };
        writeFileSync(
          path.join(ingest, `${id}.json`),
          JSON.stringify({ version: 1, sourceId: id, path: C_PDF, runs: [run] }),
        );
      },
    });
    mcp = await connectTestClient(t);
  });
  afterAll(async () => {
    await mcp?.close();
    await t?.close();
  });

  it('reports orphans, broken links, missing concepts, sources not ingested or changed, old pages', async () => {
    const report = (await mcp.call('wiki_lint')).data;
    expect(report.orphanPages).toEqual(['wiki/concepts/Cũ.md', 'wiki/concepts/Orphan.md']);
    expect(report.brokenLinks).toContainEqual({
      page: 'wiki/index.md',
      target: 'wiki/papers/Gone',
    });
    expect(report.brokenLinks).toContainEqual({ page: 'wiki/papers/A.md', target: 'Khái niệm X' });
    expect(
      report.brokenLinks.filter((l: { page: string }) => l.page === 'wiki/papers/C.md'),
    ).toHaveLength(2);
    expect(report.missingConcepts).toEqual([{ name: 'Khái niệm X', mentions: 3 }]);
    expect(report.notIngested).toEqual([A_PDF]);
    expect(report.sourceChanged).toEqual([{ page: 'wiki/papers/A.md', source: A_PDF }]);
    expect(report.reviewCandidates).toEqual([
      { page: 'wiki/concepts/Cũ.md', lastModified: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    ]);
    expect(report.sourcesAvailable).toBe(true);
    expect(report.counts).toEqual({
      orphanPages: 2,
      brokenLinks: report.brokenLinks.length,
      missingConcepts: 1,
      notIngested: 1,
      sourceChanged: 1,
      reviewCandidates: 1,
    });
  });

  it('caps every list at 100 entries and keeps the full totals in counts', () => {
    const capped = capLists({ many: Array.from({ length: 150 }, (_, i) => i), few: [1] });
    expect(capped.many).toHaveLength(100);
    expect(capped.counts).toEqual({ many: 150, few: 1 });
  });

  it('still reports what it can without the source-text service', async () => {
    const context = new Proxy(t.context, {
      get: (target, key) => (key === 'plugin' ? () => null : Reflect.get(target, key)),
    }) as AppContext;
    const report = await wikiLint({ context, settings: () => t.settings, locks: new KeyedLock() });
    expect(report).toMatchObject({ notIngested: [], sourcesAvailable: false });
    expect(report.sourceChanged).toEqual([{ page: 'wiki/papers/A.md', source: A_PDF }]);
  });
});
