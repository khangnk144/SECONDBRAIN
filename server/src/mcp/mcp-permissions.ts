/**
 * The MCP permission table (SPEC F32 "Permissions, server-enforced, by caller = MCP"), as one
 * pure function every write tool calls before it touches the vault. Paths reaching it are already
 * through the path guard (so `..`, absolute paths and `.secondbrain/` never get here).
 *
 * | Area                               | MCP may                                                  |
 * |------------------------------------|----------------------------------------------------------|
 * | `wiki/**` except index.md, log.md  | create and write through `write_wiki_page`               |
 * | `wiki/index.md`                    | replace through `wiki_index_update` only                 |
 * | `wiki/log.md`                      | append through `wiki_log_append` only                    |
 * | `0 Inbox/<name>.md`                | create through `capture_to_inbox`                        |
 * | `Daily/<today>.md`                 | create from the template and append (`append_to_daily`)  |
 * | other user and archived notes      | write (never create) through `write_note`, setting on    |
 * | `3 Resources/**`, `CLAUDE.md`, `Templates/**`, attachments, non-Markdown files | nothing |
 * | any path that leads elsewhere through a folder link or a short name | nothing (`linked-path`) |
 */
import { classifyPath, isNotePath } from '../markdown/content-classes.js';
import type { VaultPath } from '../vault/vault-types.js';

export type McpWriteOp =
  | 'write_wiki_page'
  | 'wiki_index_update'
  | 'wiki_log_append'
  | 'capture_to_inbox'
  | 'append_to_daily'
  | 'write_note';

export interface McpWriteAttempt {
  op: McpWriteOp;
  /** Guarded vault path (NFC). */
  path: VaultPath;
  /** The tool would create the file (it does not exist yet). */
  create: boolean;
  /** Settings "Cho phép AI sửa ghi chú cá nhân" (`mcp.allowNoteEdits`). */
  allowNoteEdits: boolean;
  /** Today's local calendar date (YYYY-MM-DD). */
  today: string;
}

export type McpPermissionRule =
  | 'app-state'
  | 'notes-only'
  | 'sources-read-only'
  | 'templates-read-only'
  | 'attachments-read-only'
  | 'claude-md-read-only'
  | 'wiki-index-via-wiki_index_update'
  | 'wiki-log-append-only'
  | 'wiki-pages-only'
  | 'wiki-via-write_wiki_page'
  | 'inbox-create-only'
  | 'daily-today-only'
  | 'no-create-outside-wiki-and-inbox'
  | 'note-edits-off'
  | 'linked-path';

export type McpPermission =
  { allowed: true } | { allowed: false; rule: McpPermissionRule; message: string };

const ALLOW: McpPermission = { allowed: true };
const deny = (rule: McpPermissionRule, message: string): McpPermission => ({
  allowed: false,
  rule,
  message,
});

const WIKI_INDEX = 'wiki/index.md';
const WIKI_LOG = 'wiki/log.md';

/** Areas no MCP tool may write, whatever the tool. */
function areaRefusal(path: VaultPath, lower: string): McpPermission | null {
  const top = lower.split('/')[0];
  if (top === '.secondbrain' || top === '.git') {
    return deny('app-state', 'App state is not reachable through MCP.');
  }
  if (!isNotePath(path)) return deny('notes-only', 'MCP can only write Markdown notes (.md).');
  if (lower === 'claude.md') {
    return deny('claude-md-read-only', 'CLAUDE.md is read-only for MCP; the owner edits it.');
  }
  switch (classifyPath(path)) {
    case 'source':
      return deny('sources-read-only', 'Files in 3 Resources/ are raw sources: read-only.');
    case 'template':
      return deny('templates-read-only', 'Templates/ is read-only for MCP.');
    case 'attachment':
      return deny('attachments-read-only', 'Attachments are read-only for MCP.');
    default:
      return null;
  }
}

function wikiControlRefusal(op: McpWriteOp, lower: string): McpPermission | null {
  if (lower === WIKI_INDEX && op !== 'wiki_index_update') {
    return deny('wiki-index-via-wiki_index_update', 'Change wiki/index.md with wiki_index_update.');
  }
  if (lower === WIKI_LOG && op !== 'wiki_log_append') {
    return deny('wiki-log-append-only', 'wiki/log.md is append-only: use wiki_log_append.');
  }
  return null;
}

/**
 * The table judges the requested path; a folder link (symlink, junction) or a Windows short name
 * (`3RESOU~1`) would make the write land on another path it never judged. `real` is where the
 * path really leads (`VaultService.realPath`): anything but an NFC or letter-case variant of the
 * request is refused.
 */
export function linkedPathRefusal(requested: VaultPath, real: VaultPath): McpPermission | null {
  const fold = (p: VaultPath) => p.normalize('NFC').toLowerCase();
  if (fold(requested) === fold(real)) return null;
  return deny('linked-path', 'The path goes through a folder link; MCP writes real paths only.');
}

/** May this MCP tool make this change? Decided from the path, the tool and the setting only. */
export function mcpWritePermission(attempt: McpWriteAttempt): McpPermission {
  const { op, path } = attempt;
  const lower = path.normalize('NFC').toLowerCase();
  const refusal = areaRefusal(path, lower) ?? wikiControlRefusal(op, lower);
  if (refusal) return refusal;
  const cls = classifyPath(path);
  switch (op) {
    case 'write_wiki_page':
      return cls === 'wiki'
        ? ALLOW
        : deny('wiki-pages-only', 'write_wiki_page writes pages under wiki/ only.');
    case 'wiki_index_update':
      return lower === WIKI_INDEX ? ALLOW : deny('wiki-pages-only', 'Only wiki/index.md.');
    case 'wiki_log_append':
      return lower === WIKI_LOG ? ALLOW : deny('wiki-log-append-only', 'Only wiki/log.md.');
    case 'capture_to_inbox': {
      const segments = lower.split('/');
      const inInbox = segments.length === 2 && segments[0] === '0 inbox';
      return inInbox && attempt.create
        ? ALLOW
        : deny('inbox-create-only', 'capture_to_inbox only creates new notes in 0 Inbox/.');
    }
    case 'append_to_daily':
      return lower === `daily/${attempt.today}.md`
        ? ALLOW
        : deny('daily-today-only', "append_to_daily only adds to today's daily note.");
    case 'write_note':
      if (cls === 'wiki') {
        return deny('wiki-via-write_wiki_page', 'Wiki pages are written with write_wiki_page.');
      }
      if (attempt.create) {
        return deny(
          'no-create-outside-wiki-and-inbox',
          'write_note never creates notes; MCP creates notes only in wiki/ and 0 Inbox/.',
        );
      }
      if (cls !== 'user' && cls !== 'archived') {
        return deny('notes-only', 'write_note changes the owner’s own notes only.');
      }
      return attempt.allowNoteEdits
        ? ALLOW
        : deny('note-edits-off', 'The owner has not allowed AI to edit personal notes (Settings).');
  }
}
