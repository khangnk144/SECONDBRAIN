import { describe, expect, it } from 'vitest';
import { mcpWritePermission, type McpWriteOp } from '../../src/mcp/mcp-permissions.js';

const TODAY = '2026-10-21';
const decide = (op: McpWriteOp, path: string, create = false, allowNoteEdits = false) =>
  mcpWritePermission({ op, path, create, allowNoteEdits, today: TODAY });
const rule = (decision: ReturnType<typeof decide>) =>
  decision.allowed ? 'allowed' : decision.rule;

describe('MCP permission table (F32.2)', () => {
  it.each([
    ['write_wiki_page', 'wiki/papers/Bài báo.md', true, 'allowed'],
    ['write_wiki_page', 'wiki/concepts/x.md', false, 'allowed'],
    ['write_wiki_page', 'WIKI/Index.md', false, 'wiki-index-via-wiki_index_update'],
    ['write_wiki_page', 'wiki/log.md', false, 'wiki-log-append-only'],
    ['write_wiki_page', 'wiki/LOG.MD', false, 'wiki-log-append-only'],
    ['write_wiki_page', '3 Resources/x.md', true, 'sources-read-only'],
    ['write_wiki_page', 'CLAUDE.md', false, 'claude-md-read-only'],
    ['write_wiki_page', 'Templates/Paper.md', false, 'templates-read-only'],
    ['write_wiki_page', '1 Projects/Đồ án.md', true, 'wiki-pages-only'],
    ['write_wiki_page', 'wiki/papers/x.pdf', true, 'notes-only'],
    ['write_wiki_page', 'Attachments/2026-10/a.md', true, 'attachments-read-only'],
    ['write_wiki_page', '.secondbrain/state/x.md', true, 'app-state'],
    ['wiki_index_update', 'wiki/index.md', false, 'allowed'],
    ['wiki_log_append', 'wiki/log.md', false, 'allowed'],
    ['capture_to_inbox', '0 Inbox/Ghi nhanh.md', true, 'allowed'],
    ['capture_to_inbox', '0 Inbox/sub/x.md', true, 'inbox-create-only'],
    ['capture_to_inbox', '0 Inbox/x.md', false, 'inbox-create-only'],
    ['append_to_daily', `Daily/${TODAY}.md`, true, 'allowed'],
    ['append_to_daily', 'Daily/2026-10-20.md', false, 'daily-today-only'],
    ['write_note', '1 Projects/Đồ án.md', false, 'note-edits-off'],
    ['write_note', 'wiki/papers/x.md', false, 'wiki-via-write_wiki_page'],
    ['write_note', 'wiki/index.md', false, 'wiki-index-via-wiki_index_update'],
    ['write_note', 'Templates/Note.md', false, 'templates-read-only'],
    ['write_note', '3 Resources/web/clip.md', false, 'sources-read-only'],
    ['write_note', '0 Inbox/new.md', true, 'no-create-outside-wiki-and-inbox'],
  ] as const)('%s %s (create %s) → %s', (op, path, create, expected) => {
    expect(rule(decide(op, path, create))).toBe(expected);
  });

  it('write_note on an existing user or archived note needs the setting', () => {
    expect(rule(decide('write_note', '2 Areas/Giải tích 1.md', false, true))).toBe('allowed');
    expect(rule(decide('write_note', '4 Archive/cũ.md', false, true))).toBe('allowed');
    expect(rule(decide('write_note', 'ghi chú gốc.md', false, true))).toBe('allowed');
    expect(rule(decide('write_note', 'CLAUDE.md', false, true))).toBe('claude-md-read-only');
    expect(rule(decide('write_note', '1 Projects/new.md', true, true))).toBe(
      'no-create-outside-wiki-and-inbox',
    );
  });

  it('every refusal explains itself', () => {
    const refusal = decide('write_wiki_page', '3 Resources/x.md', true);
    expect(refusal).toMatchObject({
      allowed: false,
      message: expect.stringContaining('read-only'),
    });
  });
});
