/**
 * MCP writes through folder links inside the vault (Linux symlinks stand in for Windows
 * junctions): the permission table judges the requested path, so a path whose real location is
 * elsewhere is refused with the rule `linked-path` and nothing changes on disk.
 */
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVaultTestApp, snapshotTree, type VaultTestApp } from '../api/vault-test-app.js';
import { connectTestClient, type McpTestClient } from './mcp-test-kit.js';

const NOW = new Date('2026-10-21T09:30:00');
const ZERO = '0'.repeat(64);

function writeAt(root: string, vaultPath: string, text: string): void {
  const abs = path.join(root, ...vaultPath.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

/** A folder link at `at` to `target` (vault paths; '' = the vault root). */
function link(root: string, target: string, at: string): void {
  const abs = path.join(root, ...at.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  symlinkSync(path.join(root, ...target.split('/')), abs, 'dir');
}

const appState = (p: string) => p.startsWith('.secondbrain');

describe('MCP writes through folder links are refused (F32.2)', () => {
  let t: VaultTestApp;
  let mcp: McpTestClient;
  const disk = (p: string) => readFileSync(path.join(t.vaultRoot, ...p.split('/')), 'utf8');

  beforeAll(async () => {
    t = await createVaultTestApp(47610, {
      now: () => NOW,
      seed: (root) => {
        writeAt(root, '3 Resources/papers/bài báo.md', 'nguồn gốc\n');
        writeAt(root, 'Templates/Daily.md', '# mẫu\n');
        writeAt(root, 'CLAUDE.md', '# rules\n');
        writeAt(root, 'wiki/log.md', '# Nhật ký wiki\n\n## [2026-10-01] ingest | Cũ\n');
        writeAt(root, 'wiki/Trang.md', '# trang\n');
        writeAt(root, '1 Projects/Đồ án.md', '# riêng tư\n');
        link(root, '3 Resources', 'wiki/nguon');
        link(root, 'Templates', 'wiki/mau');
        link(root, '', 'wiki/goc');
        link(root, 'Templates', '2 Areas/mẫu của tôi');
      },
    });
    mcp = await connectTestClient(t);
  });
  afterAll(async () => {
    await mcp?.close();
    await t?.close();
  });

  it('the vault names the real path of a linked one, NFC and true case for the others', async () => {
    const { vault } = t.context;
    expect(await vault.realPath('wiki/goc/CLAUDE.md')).toBe('CLAUDE.md');
    expect(await vault.realPath('wiki/nguon/papers/mới.md')).toBe('3 Resources/papers/mới.md');
    expect(await vault.realPath('WIKI/Trang.md'.normalize('NFD'))).toBe('wiki/Trang.md');
    expect(await vault.realPath('wiki/concepts/Mới.md')).toBe('wiki/concepts/Mới.md');
  });

  it.each([
    ['a new raw source in 3 Resources/', 'wiki/nguon/papers/mới.md', null],
    [
      'a raw source in 3 Resources/',
      'wiki/nguon/papers/bài báo.md',
      '3 Resources/papers/bài báo.md',
    ],
    ['CLAUDE.md', 'wiki/goc/CLAUDE.md', 'CLAUDE.md'],
    ['wiki/log.md (append-only)', 'wiki/goc/wiki/log.md', 'wiki/log.md'],
    ['a personal note with note edits off', 'wiki/goc/1 Projects/Đồ án.md', '1 Projects/Đồ án.md'],
    ['a template', 'wiki/mau/Daily.md', 'Templates/Daily.md'],
  ])('write_wiki_page cannot reach %s', async (_label, requested, real) => {
    const before = snapshotTree(t.vaultRoot, appState);
    const revision = real ? (await mcp.call('read_note', { path: requested })).data.revision : null;
    const result = await mcp.call('write_wiki_page', {
      path: requested,
      content: 'REPLACED\n',
      ...(revision ? { expectedRevision: revision } : {}),
    });
    expect(result.isError).toBe(true);
    expect(result.data).toMatchObject({ code: 'FORBIDDEN', details: { rule: 'linked-path' } });
    expect(snapshotTree(t.vaultRoot, appState)).toEqual(before);
    if (real) expect(disk(real)).not.toBe('REPLACED\n');
  });

  it('write_note with note edits on cannot reach a template through a link', async () => {
    t.settings.mcp = { allowNoteEdits: true };
    try {
      const requested = '2 Areas/mẫu của tôi/Daily.md';
      const read = await mcp.call('read_note', { path: requested });
      const result = await mcp.call('write_note', {
        path: requested,
        content: 'x',
        expectedRevision: read.data.revision,
      });
      expect(result.data).toMatchObject({ code: 'FORBIDDEN', details: { rule: 'linked-path' } });
      expect(disk('Templates/Daily.md')).toBe('# mẫu\n');
    } finally {
      t.settings.mcp = { allowNoteEdits: false };
    }
  });

  it('writes on real paths still work, also in another letter case or NFD', async () => {
    const created = await mcp.call('write_wiki_page', {
      path: 'WIKI/concepts/Định lý.md'.normalize('NFD'),
      content: '# Định lý\n',
    });
    expect(created.data).toMatchObject({ path: 'wiki/concepts/Định lý.md', created: true });
    const replaced = await mcp.call('write_wiki_page', {
      path: 'wiki/concepts/Định lý.md'.normalize('NFD'),
      content: '# Định lý 2\n',
      expectedRevision: created.data.revision,
    });
    expect(replaced.data).toMatchObject({ path: 'wiki/concepts/Định lý.md', created: false });
    const logged = await mcp.call('wiki_log_append', { line: '## [2026-10-21] query | Bayes' });
    expect(logged.isError).toBe(false);
  });
});

describe('MCP capture, daily, log and index writes when their folder is a link (F32.2)', () => {
  let t: VaultTestApp;
  let mcp: McpTestClient;

  beforeAll(async () => {
    t = await createVaultTestApp(47611, {
      now: () => NOW,
      seed: (root) => {
        writeAt(root, 'Templates/Daily.md', '# mẫu\n');
        writeAt(root, '2 Areas/Sổ wiki/log.md', '# Nhật ký wiki\n');
        writeAt(root, '2 Areas/Sổ wiki/index.md', '# Mục lục\n');
        mkdirSync(path.join(root, '3 Resources', 'Nhật ký'), { recursive: true });
        link(root, 'Templates', '0 Inbox');
        link(root, '3 Resources/Nhật ký', 'Daily');
        link(root, '2 Areas/Sổ wiki', 'wiki');
      },
    });
    mcp = await connectTestClient(t);
  });
  afterAll(async () => {
    await mcp?.close();
    await t?.close();
  });

  it('capture_to_inbox, append_to_daily, wiki_log_append and wiki_index_update are refused', async () => {
    const before = snapshotTree(t.vaultRoot, appState);
    const index = await mcp.call('read_note', { path: 'wiki/index.md' });
    const calls: [string, Record<string, unknown>][] = [
      ['capture_to_inbox', { text: 'Ý tưởng mới' }],
      ['append_to_daily', { text: 'Đọc xong bài 1.' }],
      ['wiki_log_append', { line: '## [2026-10-21] query | Bayes' }],
      ['wiki_index_update', { content: '# Khác\n', expectedRevision: index.data.revision }],
      ['wiki_index_update', { content: '# Khác\n', expectedRevision: ZERO }],
    ];
    for (const [tool, args] of calls) {
      const result = await mcp.call(tool, args);
      expect([tool, result.data]).toMatchObject([
        tool,
        { code: 'FORBIDDEN', details: { rule: 'linked-path' } },
      ]);
    }
    expect(snapshotTree(t.vaultRoot, appState)).toEqual(before);
  });
});
