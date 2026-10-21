import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toLocalDate } from '../../src/lib/local-date.js';
import { writeOnePagePdf } from '../../src/sample-data/minimal-pdf-writer.js';
import { createSourcesPlugin } from '../../src/sources/sources-plugin.js';
import { createVaultTestApp, type VaultTestApp } from '../api/vault-test-app.js';
import { connectTestClient, type McpTestClient } from './mcp-test-kit.js';

const PORT = 47728;
const PAPER = '3 Resources/papers/Thống kê Bayes.pdf';
const BLANK = '3 Resources/papers/bản quét.pdf';

describe('ingest of a real text PDF through the sources plugin (F32.3, F32.4)', () => {
  let t: VaultTestApp;
  let mcp: McpTestClient;
  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      plugins: [createSourcesPlugin({ debounceMs: 30 })],
      seed: (root) => {
        mkdirSync(path.join(root, '3 Resources', 'papers'), { recursive: true });
        const text = writeOnePagePdf({
          title: 'Bayesian Statistics for Students',
          byline: ['Generated test fixture'],
          paragraphs: ['Bayes theorem updates a prior belief with evidence to give a posterior.'],
        });
        writeFileSync(path.join(root, PAPER), text);
        writeFileSync(path.join(root, BLANK), writeOnePagePdf({ title: '', paragraphs: [] }));
      },
    });
    mcp = await connectTestClient(t);
  }, 60_000);
  afterAll(async () => {
    await mcp?.close();
    await t?.close();
  });

  it('reads the PDF text with page numbers and completes the ingest with one log line', async () => {
    const listed = (await mcp.call('list_sources')).data.sources;
    expect(listed.map((s: { path: string }) => s.path).sort()).toEqual([BLANK, PAPER].sort());
    const source = listed.find((s: { path: string }) => s.path === PAPER);
    const begun = await mcp.call('ingest_begin', { sourceId: source.sourceId });
    expect(begun.data.source.extractionQuality).toBe('ok');
    const read = await mcp.call('read_source', { path: PAPER });
    expect(read.data.chunks[0]).toMatchObject({ page: 1 });
    expect(read.data.chunks[0].text).toContain('Bayes theorem updates a prior belief');
    const page = 'wiki/papers/Thống kê Bayes.md';
    await mcp.call('write_wiki_page', {
      path: page,
      content: `---\ntype: wiki\nsource: ${PAPER}\nsource_hash: ${read.data.contentHash}\n---\n\n# Thống kê Bayes\n`,
    });
    const done = await mcp.call('ingest_complete', { runId: begun.data.runId, outputs: [page] });
    expect(done.isError).toBe(false);
    const log = readFileSync(path.join(t.vaultRoot, 'wiki', 'log.md'), 'utf8');
    expect(log.match(/^## \[/gm)).toHaveLength(1);
    expect(log).toContain(`## [${toLocalDate(new Date())}] ingest | `);
  });

  it('a PDF without text is quality none and cannot be marked ingested', async () => {
    const read = await mcp.call('read_source', { path: BLANK });
    expect(read.data.extractionQuality).toBe('none');
    const listed = (await mcp.call('list_sources')).data.sources;
    const blank = listed.find((s: { path: string }) => s.path === BLANK);
    const begun = await mcp.call('ingest_begin', { sourceId: blank.sourceId });
    const done = await mcp.call('ingest_complete', {
      runId: begun.data.runId,
      outputs: ['wiki/papers/Thống kê Bayes.md'],
    });
    expect(done.data.code).toBe('NEEDS_REVIEW');
  });
});
