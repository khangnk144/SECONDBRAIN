import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readManifest } from '../../src/mcp/ingest-manifest.js';
import { createVaultTestApp, type VaultTestApp } from '../api/vault-test-app.js';
import {
  connectTestClient,
  fakeSourceId,
  fakeSourcesPlugin,
  recordBroadcasts,
  type FakeSourceText,
  type McpTestClient,
} from './mcp-test-kit.js';

const PORT = 47722;
const BAYES = '3 Resources/papers/Bài báo Bayes.pdf';
const MARKOV = '3 Resources/papers/Chuỗi Markov.pdf';
const SCAN = '3 Resources/papers/bản scan.pdf';
const MOVING = '3 Resources/papers/đang sửa.pdf';
const PAPER_PAGE = 'wiki/papers/Học Bayes.md';
const CONCEPT_PAGE = 'wiki/concepts/Định lý Bayes.md';

const scripts = new Map<string, FakeSourceText>([
  [
    BAYES,
    { pages: ['Trang 1: định lý Bayes.', 'Trang 2: ví dụ.'], title: 'Học Bayes\ncho sinh viên' },
  ],
  [MARKOV, { pages: ['Chuỗi Markov.'], title: 'Chuỗi Markov' }],
  [SCAN, { pages: [''], quality: 'none', reason: 'no-text' }],
  [MOVING, { pages: ['Bản nháp.'] }],
]);

describe('MCP ingest sequence with a scripted client (F32.3, F32.4)', () => {
  let t: VaultTestApp;
  let mcp: McpTestClient;
  let clock = new Date('2026-10-21T09:00:00');
  const disk = (p: string) => readFileSync(path.join(t.vaultRoot, p), 'utf8');
  const logLines = () =>
    disk('wiki/log.md')
      .split('\n')
      .filter((l) => l.startsWith('## ['));
  const manifest = (p: string) => readManifest(t.context.vault.paths.ingestDir, fakeSourceId(p));
  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      now: () => clock,
      plugins: [fakeSourcesPlugin(scripts)],
      seed: (root) => {
        mkdirSync(path.join(root, '3 Resources', 'papers'), { recursive: true });
        for (const p of [BAYES, MARKOV, SCAN, MOVING])
          writeFileSync(path.join(root, p), `%PDF ${p}`);
      },
    });
    mcp = await connectTestClient(t);
  });
  afterAll(async () => {
    await mcp?.close();
    await t?.close();
  });

  it('runs the documented sequence: list → begin → read → pages → index → complete', async () => {
    const events = recordBroadcasts(t);
    const listed = await mcp.call('list_sources');
    const bayes = listed.data.sources.find((s: { path: string }) => s.path === BAYES);
    expect(bayes).toMatchObject({ status: 'new', extractionQuality: 'ok', lastRun: null });

    const begun = await mcp.call('ingest_begin', { sourceId: bayes.sourceId });
    expect(begun.data.source).toMatchObject({ path: BAYES, extractionQuality: 'ok' });
    const read = await mcp.call('read_source', { path: BAYES });
    expect(read.data).toMatchObject({
      pageCount: 2,
      nextPage: null,
      contentHash: bayes.contentHash,
    });
    expect(read.data.chunks.map((c: { page: number }) => c.page)).toEqual([1, 2]);

    const paper = `---\ntype: wiki\nsource: ${BAYES}\nsource_hash: ${read.data.contentHash}\n---\n\n# Học Bayes\n\n## Tóm tắt\n\nĐịnh lý Bayes (tr. 1).\n`;
    expect((await mcp.call('write_wiki_page', { path: PAPER_PAGE, content: paper })).isError).toBe(
      false,
    );
    const concept = `# Định lý Bayes\n\n[[${PAPER_PAGE.slice(0, -3)}]] (tr. 1)\n`;
    expect(
      (await mcp.call('write_wiki_page', { path: CONCEPT_PAGE, content: concept })).isError,
    ).toBe(false);
    const index = await mcp.call('wiki_index_update', {
      content: `# Mục lục\n\n- [[wiki/papers/Học Bayes]]\n- [[wiki/concepts/Định lý Bayes]]\n`,
      expectedRevision: null,
    });
    expect(index.isError).toBe(false);

    const outputs = [PAPER_PAGE, CONCEPT_PAGE, 'wiki/index.md'];
    const done = await mcp.call('ingest_complete', { runId: begun.data.runId, outputs });
    expect(done.data).toMatchObject({ status: 'succeeded', source: BAYES, outputs });
    expect(done.data.logLine).toBe('## [2026-10-21] ingest | Học Bayes cho sinh viên');
    expect(logLines()).toEqual(['## [2026-10-21] ingest | Học Bayes cho sinh viên']);
    expect(disk('wiki/log.md').startsWith('# Nhật ký wiki\n\n')).toBe(true);
    const stored = await manifest(BAYES);
    expect(stored?.runs).toHaveLength(1);
    expect(stored?.runs[0]).toMatchObject({
      status: 'succeeded',
      outputs,
      contentHash: bayes.contentHash,
    });
    expect(events.filter((e) => e.type === 'ai:touched')).toEqual([
      { type: 'ai:touched', source: BAYES, outputs },
    ]);

    // Completing again answers the same and appends nothing.
    const again = await mcp.call('ingest_complete', {
      runId: begun.data.runId,
      outputs: [PAPER_PAGE],
    });
    expect(again.data).toEqual(done.data);
    expect(logLines()).toHaveLength(1);
    const after = await mcp.call('list_sources');
    expect(after.data.sources.find((s: { path: string }) => s.path === BAYES).status).toBe(
      'ingested',
    );
  });

  it('refuses to ingest the same content again unless forced', async () => {
    const id = fakeSourceId(BAYES);
    const refused = await mcp.call('ingest_begin', { sourceId: id });
    expect(refused.data).toMatchObject({ code: 'EXISTS', details: { reason: 'already-ingested' } });
    const forced = await mcp.call('ingest_begin', { sourceId: id, force: true });
    expect(forced.isError).toBe(false);
    const busy = await mcp.call('ingest_begin', { sourceId: id, force: true });
    expect(busy.data).toMatchObject({ code: 'CONFLICT', details: { runId: forced.data.runId } });
    const failed = await mcp.call('ingest_fail', {
      runId: forced.data.runId,
      reason: 'thử\nlại sau',
    });
    expect(failed.data).toEqual({
      runId: forced.data.runId,
      status: 'failed',
      reason: 'thử lại sau',
    });
    expect(logLines()).toHaveLength(1);
  });

  it('an interrupted ingest retried with a new run leaves no duplicate page or log line', async () => {
    const id = fakeSourceId(MARKOV);
    const first = await mcp.call('ingest_begin', { sourceId: id });
    const page = 'wiki/papers/Chuỗi Markov.md';
    await mcp.call('write_wiki_page', { path: page, content: '# Markov\n' });
    // The model stops here. A new run is refused while the old one may still be alive…
    expect((await mcp.call('ingest_begin', { sourceId: id })).data.code).toBe('CONFLICT');
    clock = new Date(clock.getTime() + 61 * 60 * 1000);
    // …and after an hour the abandoned run is failed (stale) and a new one starts.
    const retry = await mcp.call('ingest_begin', { sourceId: id });
    expect(retry.isError).toBe(false);
    expect((await manifest(MARKOV))?.runs.map((r) => [r.status, r.reason])).toEqual([
      ['failed', 'stale'],
      ['running', null],
    ]);
    const exists = await mcp.call('write_wiki_page', { path: page, content: '# Markov 2\n' });
    expect(exists.data.code).toBe('EXISTS');
    await mcp.call('write_wiki_page', {
      path: page,
      content: '# Markov 2\n',
      expectedRevision: exists.data.details.currentRevision,
    });
    expect(
      (await mcp.call('ingest_complete', { runId: retry.data.runId, outputs: [page] })).isError,
    ).toBe(false);
    expect(
      readdirSync(path.join(t.vaultRoot, 'wiki', 'papers')).filter((n) => n.includes('Markov')),
    ).toEqual(['Chuỗi Markov.md']);
    expect(logLines().filter((l) => l.includes('Chuỗi Markov'))).toHaveLength(1);
    expect(
      (await mcp.call('ingest_complete', { runId: first.data.runId, outputs: [page] })).data,
    ).toMatchObject({
      code: 'CONFLICT',
      details: { status: 'failed', reason: 'stale' },
    });
  });

  it('a source without text: read_source says none, ingest_complete is NEEDS_REVIEW, no log line', async () => {
    const lines = logLines().length;
    const read = await mcp.call('read_source', { path: SCAN });
    expect(read.data).toMatchObject({ extractionQuality: 'none', reason: 'no-text' });
    const begun = await mcp.call('ingest_begin', { sourceId: fakeSourceId(SCAN) });
    const done = await mcp.call('ingest_complete', {
      runId: begun.data.runId,
      outputs: [PAPER_PAGE],
    });
    expect(done.data).toMatchObject({ code: 'NEEDS_REVIEW', details: { reason: 'no-text' } });
    expect((await manifest(SCAN))?.runs[0]).toMatchObject({
      status: 'failed',
      reason: 'needs-review',
    });
    expect(logLines()).toHaveLength(lines);
    const listed = await mcp.call('list_sources');
    expect(listed.data.sources.find((s: { path: string }) => s.path === SCAN).status).toBe(
      'needs-review',
    );
  });

  it('refuses missing outputs and a source that changed during the run', async () => {
    const id = fakeSourceId(MOVING);
    const begun = await mcp.call('ingest_begin', { sourceId: id });
    const missing = await mcp.call('ingest_complete', {
      runId: begun.data.runId,
      outputs: ['wiki/papers/không có.md', '1 Projects/x.md'],
    });
    expect(missing.data).toMatchObject({
      code: 'VALIDATION',
      details: { missing: ['wiki/papers/không có.md'], notWiki: ['1 Projects/x.md'] },
    });
    expect((await manifest(MOVING))?.runs[0]?.status).toBe('running');
    writeFileSync(path.join(t.vaultRoot, MOVING), '%PDF changed');
    const changed = await mcp.call('ingest_complete', {
      runId: begun.data.runId,
      outputs: [PAPER_PAGE],
    });
    expect(changed.data).toMatchObject({ code: 'CONFLICT', details: { reason: 'source-changed' } });
    expect((await manifest(MOVING))?.runs[0]).toMatchObject({
      status: 'failed',
      reason: 'source-changed',
    });
  });

  it('unknown ids and run ids are refused without touching anything', async () => {
    expect((await mcp.call('ingest_begin', { sourceId: 'src_0000000000000000' })).data.code).toBe(
      'NOT_FOUND',
    );
    expect((await mcp.call('ingest_begin', { sourceId: '../../x' })).data.code).toBe('VALIDATION');
    expect(
      (await mcp.call('ingest_complete', { runId: 'nope', outputs: [PAPER_PAGE] })).data.code,
    ).toBe('NOT_FOUND');
    expect(
      (await mcp.call('ingest_fail', { runId: 'src_x.01JAAAAAAAAAAAAAAAAAAAAAAA', reason: 'x' }))
        .data.code,
    ).toBe('NOT_FOUND');
  });
});
