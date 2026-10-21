import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toLocalDate } from '../../src/lib/local-date.js';
import { createVaultTestApp, snapshotTree, type VaultTestApp } from '../api/vault-test-app.js';
import { connectTestClient, recordBroadcasts, type McpTestClient } from './mcp-test-kit.js';

const PORT = 47723;
const NOW = new Date('2026-10-21T09:30:00');
const TODAY = toLocalDate(NOW);
const ZERO = '0'.repeat(64);

describe('MCP write tools and the permission table (F32.2)', () => {
  let t: VaultTestApp;
  let mcp: McpTestClient;
  const disk = (p: string) => readFileSync(path.join(t.vaultRoot, p));
  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      now: () => NOW,
      seed: (root) => {
        const write = (p: string, text: string) => {
          const abs = path.join(root, p);
          mkdirSync(path.dirname(abs), { recursive: true });
          writeFileSync(abs, text);
        };
        write('1 Projects/Đồ án Giải tích.md', '---\ntype: project\n---\n\n# Đồ án\n');
        write('3 Resources/x.md', 'nguồn\n');
        write('wiki/log.md', '# Nhật ký wiki\r\n\r\n## [2026-10-01] ingest | Cũ\r\n');
        // NFD file name from macOS
        write('2 Areas/Ghi chu\u0301 NFD.md'.normalize('NFD'), 'nfd\n');
      },
    });
    mcp = await connectTestClient(t);
  });
  afterAll(async () => {
    await mcp?.close();
    await t?.close();
  });

  it.each([
    [
      'write_wiki_page',
      { path: '3 Resources/x.md', content: 'x' },
      'FORBIDDEN',
      'sources-read-only',
    ],
    [
      'write_wiki_page',
      { path: 'CLAUDE.md', content: 'x', expectedRevision: ZERO },
      'FORBIDDEN',
      'claude-md-read-only',
    ],
    [
      'write_wiki_page',
      { path: 'Templates/Paper.md', content: 'x', expectedRevision: ZERO },
      'FORBIDDEN',
      'templates-read-only',
    ],
    [
      'write_wiki_page',
      { path: 'wiki/log.md', content: 'x', expectedRevision: ZERO },
      'FORBIDDEN',
      'wiki-log-append-only',
    ],
    [
      'write_wiki_page',
      { path: 'wiki/index.md', content: 'x' },
      'FORBIDDEN',
      'wiki-index-via-wiki_index_update',
    ],
    [
      'write_wiki_page',
      { path: '.secondbrain/state/x.md', content: 'x' },
      'INVALID_PATH',
      undefined,
    ],
    ['write_wiki_page', { path: '../x.md', content: 'x' }, 'INVALID_PATH', undefined],
    [
      'write_note',
      { path: '1 Projects/Đồ án Giải tích.md', content: 'x', expectedRevision: ZERO },
      'FORBIDDEN',
      'note-edits-off',
    ],
    [
      'write_note',
      { path: '1 Projects/Mới.md', content: 'x', expectedRevision: ZERO },
      'FORBIDDEN',
      'no-create-outside-wiki-and-inbox',
    ],
    [
      'write_note',
      { path: '.secondbrain/state/sample.json', content: 'x', expectedRevision: ZERO },
      'INVALID_PATH',
      undefined,
    ],
  ] as const)('%s %j → %s', async (tool, args, code, rule) => {
    const before = snapshotTree(t.vaultRoot, (p) => p.startsWith('.secondbrain'));
    const result = await mcp.call(tool, args);
    expect(result.isError).toBe(true);
    expect(result.data.code).toBe(code);
    if (rule) expect(result.data.details.rule).toBe(rule);
    expect(snapshotTree(t.vaultRoot, (p) => p.startsWith('.secondbrain'))).toEqual(before);
  });

  it('write_note edits a user note only with the setting on, at the revision read', async () => {
    const note = '1 Projects/Đồ án Giải tích.md';
    const read = await mcp.call('read_note', { path: note });
    t.settings.mcp = { allowNoteEdits: true };
    try {
      const stale = await mcp.call('write_note', {
        path: note,
        content: 'x',
        expectedRevision: ZERO,
      });
      expect(stale.data).toMatchObject({
        code: 'CONFLICT',
        details: { currentRevision: read.data.revision },
      });
      expect(stale.data.details.currentContent).toBeUndefined();
      const ok = await mcp.call('write_note', {
        path: note,
        content: `${read.data.content}Thêm.\n`,
        expectedRevision: read.data.revision,
      });
      expect(ok.isError).toBe(false);
      expect(disk(note).toString()).toBe(`${read.data.content}Thêm.\n`);
    } finally {
      t.settings.mcp = { allowNoteEdits: false };
    }
  });

  it('wiki_log_append only appends: every earlier byte stays, CRLF kept', async () => {
    const before = disk('wiki/log.md');
    const result = await mcp.call('wiki_log_append', {
      line: '## [2026-10-21] query | Bayes là gì?',
    });
    expect(result.isError).toBe(false);
    const after = disk('wiki/log.md');
    expect(after.subarray(0, before.length).equals(before)).toBe(true);
    expect(after.subarray(before.length).toString()).toBe(
      '## [2026-10-21] query | Bayes là gì?\r\n',
    );
    for (const line of ['', 'a\nb', 'a\u2028b', 'x'.repeat(501)]) {
      expect((await mcp.call('wiki_log_append', { line })).data.code).toBe('VALIDATION');
    }
    expect(disk('wiki/log.md').equals(after)).toBe(true);
  });

  it('write_wiki_page creates, refuses a second create with EXISTS + revision, replaces at the revision', async () => {
    const page = 'wiki/concepts/Định lý Bayes.md';
    const created = await mcp.call('write_wiki_page', { path: page, content: '# Bayes\n' });
    expect(created.data).toMatchObject({ path: page, created: true });
    const again = await mcp.call('write_wiki_page', { path: page, content: '# Khác\n' });
    expect(again.data).toMatchObject({
      code: 'EXISTS',
      details: { currentRevision: created.data.revision },
    });
    const replaced = await mcp.call('write_wiki_page', {
      path: page,
      content: '# Bayes 2\n',
      expectedRevision: created.data.revision,
    });
    expect(replaced.data.created).toBe(false);
    expect(disk(page).toString()).toBe('# Bayes 2\n');
    const big = await mcp.call('write_wiki_page', {
      path: 'wiki/x.md',
      content: 'ể'.repeat(400_000),
    });
    expect(big.data).toMatchObject({ code: 'VALIDATION', details: { reason: 'too-large' } });
  });

  it('wiki_index_update creates with null and replaces with the revision', async () => {
    const created = await mcp.call('wiki_index_update', {
      content: '# Mục lục\n',
      expectedRevision: null,
    });
    expect(created.data).toMatchObject({ path: 'wiki/index.md', created: true });
    const exists = await mcp.call('wiki_index_update', { content: 'x', expectedRevision: null });
    expect(exists.data.code).toBe('EXISTS');
    const updated = await mcp.call('wiki_index_update', {
      content: '# Mục lục\n\n- [[wiki/concepts/Định lý Bayes]]\n',
      expectedRevision: created.data.revision,
    });
    expect(updated.isError).toBe(false);
  });

  it('capture_to_inbox creates a uniquely named Inbox note and the clients hear about it', async () => {
    const events = recordBroadcasts(t);
    const first = await mcp.call('capture_to_inbox', { text: 'Ý tưởng: đọc thêm về Bayes' });
    const second = await mcp.call('capture_to_inbox', { text: 'Ý tưởng: đọc thêm về Bayes' });
    expect(first.data.path).toBe('0 Inbox/Ý tưởng đọc thêm về Bayes.md');
    expect(second.data.path).toBe('0 Inbox/Ý tưởng đọc thêm về Bayes 2.md');
    expect(events.some((e) => e.type === 'note:created' && e.path === first.data.path)).toBe(true);
    expect((await mcp.call('capture_to_inbox', { text: '   ' })).data.code).toBe('VALIDATION');
  });

  it("append_to_daily creates today's note from the template, then appends paragraphs", async () => {
    const daily = `Daily/${TODAY}.md`;
    const first = await mcp.call('append_to_daily', { text: 'Đọc xong bài 1.' });
    expect(first.data).toMatchObject({ path: daily, created: true });
    const created = disk(daily).toString();
    expect(created).toContain('type: daily');
    expect(created.endsWith('## Cuối ngày\n\nĐọc xong bài 1.\n')).toBe(true);
    await mcp.call('append_to_daily', { text: 'Dòng một\nDòng hai' });
    const after = disk(daily).toString();
    expect(after).toBe(`${created}\nDòng một\nDòng hai\n`);
  });

  it('paths in NFD reach the same note as NFC', async () => {
    const nfc = '2 Areas/Ghi chú NFD.md';
    const viaNfd = await mcp.call('read_note', { path: nfc.normalize('NFD') });
    expect(viaNfd.data).toMatchObject({ path: nfc, content: 'nfd\n', class: 'user' });
  });
});
