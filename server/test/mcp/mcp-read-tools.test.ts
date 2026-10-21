import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, toLocalDate } from '../../src/lib/local-date.js';
import { MCP_INSTRUCTIONS } from '../../src/mcp/create-mcp-server.js';
import { textPart } from '../../src/mcp/bounded-results.js';
import { chunkPages } from '../../src/mcp/source-tools.js';
import { createVaultTestApp, type VaultTestApp } from '../api/vault-test-app.js';
import {
  ALL_TOOLS,
  connectTestClient,
  fakeSourcesPlugin,
  type FakeSourceText,
  type McpTestClient,
} from './mcp-test-kit.js';

const PORT = 47724;
const NOW = new Date('2026-10-21T09:00:00');
const TODAY = toLocalDate(NOW);
const LONG = '3 Resources/papers/dài.pdf';
const BIG_NOTE = `${'Ghi chép dài. '.repeat(10_000)}😀 cuối.\n`;

describe('MCP read tools, resources and prompts', () => {
  let t: VaultTestApp;
  let mcp: McpTestClient;
  const scripts = new Map<string, FakeSourceText>([
    [LONG, { pages: ['a'.repeat(40_000), 'b'.repeat(40_000), 'c'.repeat(10_000)] }],
  ]);
  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      now: () => NOW,
      plugins: [fakeSourcesPlugin(scripts)],
      seed: (root) => {
        const write = (p: string, text: string) => {
          mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
          writeFileSync(path.join(root, p), text);
        };
        write('2 Areas/Giải tích 1.md', '# Giải tích 1\n\nĐạo hàm và tích phân.\n');
        write('2 Areas/Sổ tay dài.md', BIG_NOTE);
        write(
          '1 Projects/Đồ án Giải tích.md',
          `---\ntype: project\nstatus: doing\ndeadline: ${addDays(TODAY, 5)}\n---\n\n[[Giải tích 1]]\n\n- [ ] Nộp bài 📅 ${addDays(TODAY, -1)}\n- [ ] Ôn tập 📅 ${addDays(TODAY, 40)}\n`,
        );
        write('4 Archive/Cũ.md', `- [ ] Việc cũ 📅 ${TODAY}\n`);
        write(LONG, '%PDF long');
      },
    });
    mcp = await connectTestClient(t);
  });
  afterAll(async () => {
    await mcp?.close();
    await t?.close();
  });

  it('lists every tool with an input schema, the three resources, the three prompts and instructions (F32.1)', async () => {
    const { tools } = await mcp.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(ALL_TOOLS);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description?.length).toBeGreaterThan(20);
    }
    const readOnly = tools
      .filter((tool) => tool.annotations?.readOnlyHint)
      .map((tool) => tool.name);
    expect(readOnly.sort()).toEqual([
      'get_backlinks',
      'get_today',
      'get_upcoming_deadlines',
      'graph_neighbors',
      'list_notes',
      'list_sources',
      'read_note',
      'read_source',
      'search_notes',
      'wiki_lint',
    ]);
    const { resources } = await mcp.client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      'vault://CLAUDE.md',
      'vault://wiki/index.md',
      'vault://wiki/log.md',
    ]);
    const { prompts } = await mcp.client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      'answer_from_wiki',
      'ingest_source',
      'lint_wiki',
    ]);
    expect(mcp.client.getInstructions()).toBe(MCP_INSTRUCTIONS);
  });

  it('search_notes finds notes diacritic-insensitively; read_note returns content, revision, class', async () => {
    const search = await mcp.call('search_notes', { query: 'giai tich', limit: 5 });
    expect(search.data.results.map((r: { path: string }) => r.path)).toContain(
      '2 Areas/Giải tích 1.md',
    );
    const note = await mcp.call('read_note', { path: '2 Areas/Giải tích 1.md' });
    expect(note.data).toMatchObject({
      class: 'user',
      content: '# Giải tích 1\n\nĐạo hàm và tích phân.\n',
    });
    expect(note.data.revision).toMatch(/^[0-9a-f]{64}$/);
    expect((await mcp.call('read_note', { path: 'Templates/Paper.md' })).data.class).toBe(
      'template',
    );
    expect((await mcp.call('read_note', { path: 'CLAUDE.md' })).data.class).toBe('control');
    for (const bad of [
      '.secondbrain/vault.json',
      '.secondbrain/state/sample.md',
      '../x.md',
      'C:/x.md',
    ]) {
      expect((await mcp.call('read_note', { path: bad })).data.code).toBe('INVALID_PATH');
    }
    expect((await mcp.call('read_note', { path: LONG })).data.code).toBe('VALIDATION');
    expect((await mcp.call('read_note', { path: '0 Inbox/không có.md' })).data.code).toBe(
      'NOT_FOUND',
    );
  });

  it('read_note returns at most 60,000 characters per call; nextOffset continues (whole-file revision)', async () => {
    const path = '2 Areas/Sổ tay dài.md';
    const parts: string[] = [];
    let offset: number | null = 0;
    const revisions = new Set<string>();
    while (offset !== null) {
      const part: { data: Record<string, unknown> } = await mcp.call('read_note', { path, offset });
      expect((part.data.content as string).length).toBeLessThanOrEqual(60_000);
      expect(part.data).toMatchObject({ truncated: true, totalLength: BIG_NOTE.length });
      parts.push(part.data.content as string);
      revisions.add(part.data.revision as string);
      offset = part.data.nextOffset as number | null;
    }
    expect(parts).toHaveLength(3);
    expect(parts.join('')).toBe(BIG_NOTE);
    expect(revisions.size).toBe(1);
    const small = await mcp.call('read_note', { path: '2 Areas/Giải tích 1.md' });
    expect(small.data).toMatchObject({ truncated: false, nextOffset: null });
    const past = await mcp.call('read_note', { path, offset: BIG_NOTE.length + 1 });
    expect(past.data.code).toBe('VALIDATION');
    // A cut never splits a surrogate pair.
    expect(textPart(`${'a'.repeat(59_999)}😀b`, 0)).toMatchObject({ nextOffset: 59_999 });
  });

  it('list_notes pages through a folder; get_backlinks and graph_neighbors follow links', async () => {
    const all = await mcp.call('list_notes', { limit: 2 });
    expect(all.data.notes).toHaveLength(2);
    expect(all.data.nextOffset).toBe(2);
    const rest = await mcp.call('list_notes', { offset: 2 });
    expect(rest.data.notes).toHaveLength(all.data.total - 2);
    expect(rest.data.nextOffset).toBeNull();
    expect(all.data.total).toBeGreaterThan(8);
    const areas = await mcp.call('list_notes', { folder: '2 areas' });
    expect(areas.data.notes.map((n: { path: string }) => n.path)).toEqual([
      '2 Areas/Giải tích 1.md',
      '2 Areas/Sổ tay dài.md',
    ]);
    const backlinks = await mcp.call('get_backlinks', { path: '2 Areas/Giải tích 1.md' });
    expect(backlinks.data.backlinks.map((b: { fromPath: string }) => b.fromPath)).toEqual([
      '1 Projects/Đồ án Giải tích.md',
    ]);
    const graph = await mcp.call('graph_neighbors', { path: '2 Areas/Giải tích 1.md', depth: 1 });
    expect(graph.data.nodes.map((n: { id: string }) => n.id).sort()).toEqual([
      '1 Projects/Đồ án Giải tích.md',
      '2 Areas/Giải tích 1.md',
    ]);
    expect((await mcp.call('graph_neighbors', { path: 'x.md' })).data.code).toBe('NOT_FOUND');
  });

  it('get_upcoming_deadlines and get_today come from the deadline service', async () => {
    const upcoming = await mcp.call('get_upcoming_deadlines', { days: 14 });
    expect(
      upcoming.data.items.map((i: { title: string; date: string }) => [i.title, i.date]),
    ).toEqual([
      ['Nộp bài', addDays(TODAY, -1)],
      ['Đồ án Giải tích', addDays(TODAY, 5)],
    ]);
    const year = await mcp.call('get_upcoming_deadlines', { days: 365 });
    expect(year.data.items).toHaveLength(3);
    expect((await mcp.call('get_upcoming_deadlines', { days: 0 })).isError).toBe(true);
    const today = await mcp.call('get_today');
    expect(today.data.date).toBe(TODAY);
    expect(today.data.strip.days.every((d: { items: unknown[] }) => d.items.length > 0)).toBe(true);
    expect(today.data.strip.overdue).toHaveLength(1);
  });

  it('read_source returns whole pages up to about 60,000 characters and says where to continue', async () => {
    const first = await mcp.call('read_source', { path: LONG });
    expect(first.data.chunks.map((c: { page: number }) => c.page)).toEqual([1]);
    expect(first.data.nextPage).toBe(2);
    const second = await mcp.call('read_source', { path: LONG, fromPage: 2 });
    expect(second.data.chunks.map((c: { page: number }) => c.page)).toEqual([2, 3]);
    expect(second.data.nextPage).toBeNull();
    expect((await mcp.call('read_source', { path: '2 Areas/Giải tích 1.md' })).data.code).toBe(
      'VALIDATION',
    );
    expect(
      chunkPages([
        { page: 4, text: 'x'.repeat(70_000) },
        { page: 5, text: 'y' },
      ]),
    ).toMatchObject({
      chunks: [{ page: 4, truncated: true }],
      nextPage: 5,
    });
  });

  it('resources are live reads; prompts carry the CLAUDE.md sections and the question as data', async () => {
    const claude = await mcp.client.readResource({ uri: 'vault://CLAUDE.md' });
    expect((claude.contents[0] as { text: string }).text).toContain('# CLAUDE.md');
    await expect(mcp.client.readResource({ uri: 'vault://wiki/log.md' })).rejects.toThrow();
    writeFileSync(
      path.join(t.vaultRoot, 'CLAUDE.md'),
      '# Mine\n\n## Workflows\n\n### Query\n\nChỉ đọc wiki/index.md trước.\n\n### Other\n\nx\n',
    );
    const answer = await mcp.client.getPrompt({
      name: 'answer_from_wiki',
      arguments: { question: 'Bayes?' },
    });
    const text = (answer.messages[0]?.content as { text: string }).text;
    expect(text).toContain('### Query\n\nChỉ đọc wiki/index.md trước.');
    expect(text).not.toContain('### Other');
    expect(text).toContain('<<<\nBayes?\n>>>');
    // A section missing from the owner's file falls back to the bundled skeleton.
    const lint = await mcp.client.getPrompt({ name: 'lint_wiki' });
    expect((lint.messages[0]?.content as { text: string }).text).toContain('Run `wiki_lint`');
    const ingest = await mcp.client.getPrompt({ name: 'ingest_source', arguments: { path: LONG } });
    expect((ingest.messages[0]?.content as { text: string }).text).toContain(`<<<\n${LONG}\n>>>`);
  });
});
