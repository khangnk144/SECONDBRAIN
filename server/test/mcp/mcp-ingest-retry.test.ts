/**
 * `ingest_complete` retried after a manifest write failed (disk full): the log line is appended
 * exactly once, and a title with any kind of line break or control character becomes one line.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/** `failAt.n = k`: the k-th manifest write from now fails once with ENOSPC (0 = none). */
const failAt = { n: 0 };
vi.mock('../../src/mcp/ingest-manifest.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/mcp/ingest-manifest.js')>();
  return {
    ...real,
    writeManifest: async (...args: Parameters<typeof real.writeManifest>) => {
      if (failAt.n > 0 && --failAt.n === 0) {
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
      }
      return real.writeManifest(...args);
    },
  };
});

const { createVaultTestApp } = await import('../api/vault-test-app.js');
const kit = await import('./mcp-test-kit.js');

const BAYES = '3 Resources/papers/Bayes.pdf';
const MARKOV = '3 Resources/papers/Markov.pdf';
const PAGE = 'wiki/papers/Bayes.md';
const LS = String.fromCodePoint(0x2028);
const PS = String.fromCodePoint(0x2029);
/** Any control character or line/paragraph separator except the log's own line feeds. */
const CONTROLS = /(?!\n)[\p{Cc}\p{Zl}\p{Zp}]/u;

describe('ingest_complete retried after a failed manifest write (F32.3)', () => {
  let t: Awaited<ReturnType<typeof createVaultTestApp>>;
  let mcp: Awaited<ReturnType<typeof kit.connectTestClient>>;
  const log = () => readFileSync(path.join(t.vaultRoot, 'wiki', 'log.md'), 'utf8');
  const ingestLines = () =>
    log()
      .split('\n')
      .filter((line) => line.includes('] ingest | '));

  beforeAll(async () => {
    const scripts = new Map([
      // NEL, LS, PS, a C0 and a C1 control: none may split or garble the log line.
      [
        BAYES,
        { pages: ['Trang 1.'], title: `Học\u0085Bayes${LS}cho${PS}sinh\u0007viên\u009bnăm 2` },
      ],
      [MARKOV, { pages: ['Trang 1.'], title: 'Chuỗi Markov' }],
    ]);
    t = await createVaultTestApp(47612, {
      now: () => new Date('2026-10-21T09:00:00'),
      plugins: [kit.fakeSourcesPlugin(scripts)],
      seed: (root) => {
        mkdirSync(path.join(root, '3 Resources', 'papers'), { recursive: true });
        writeFileSync(path.join(root, BAYES), '%PDF bayes');
        writeFileSync(path.join(root, MARKOV), '%PDF markov');
        mkdirSync(path.join(root, 'wiki', 'papers'), { recursive: true });
        writeFileSync(path.join(root, 'wiki', 'log.md'), '# Nhật ký wiki\n');
      },
    });
    mcp = await kit.connectTestClient(t);
    await mcp.call('write_wiki_page', { path: PAGE, content: '# Bayes\n' });
  });
  afterAll(async () => {
    failAt.n = 0;
    await mcp?.close();
    await t?.close();
  });

  it('the write after the append fails: the retry succeeds without a second line', async () => {
    const begun = await mcp.call('ingest_begin', { sourceId: kit.fakeSourceId(BAYES) });
    failAt.n = 2; // the first write stores the line, the second marks the run succeeded
    const first = await mcp.call('ingest_complete', { runId: begun.data.runId, outputs: [PAGE] });
    expect(first.isError).toBe(true);
    expect(ingestLines()).toEqual(['## [2026-10-21] ingest | Học Bayes cho sinh viên năm 2']);
    const retry = await mcp.call('ingest_complete', { runId: begun.data.runId, outputs: [PAGE] });
    expect(retry.data).toMatchObject({ status: 'succeeded' });
    expect(ingestLines()).toHaveLength(1);
    expect(log()).not.toMatch(CONTROLS);
  });

  it('the write that stores the line fails: nothing is appended until the retry', async () => {
    const begun = await mcp.call('ingest_begin', { sourceId: kit.fakeSourceId(MARKOV) });
    failAt.n = 1;
    const first = await mcp.call('ingest_complete', { runId: begun.data.runId, outputs: [PAGE] });
    expect(first.isError).toBe(true);
    expect(ingestLines()).toHaveLength(1);
    const retry = await mcp.call('ingest_complete', { runId: begun.data.runId, outputs: [PAGE] });
    expect(retry.data).toMatchObject({ status: 'succeeded' });
    expect(ingestLines().at(-1)).toBe('## [2026-10-21] ingest | Chuỗi Markov');
    expect(ingestLines()).toHaveLength(2);
  });
});
