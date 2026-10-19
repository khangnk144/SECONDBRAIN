/**
 * Public contract of the Markdown layer (SPEC §4.2–§4.7, §4.14 normalization, F4 relink).
 * Everything here is pure: no file system, no database. The indexer, the relink planner and
 * (later) the editor and MCP tools all use the same functions so no view invents its own rule.
 */
import type { VaultPath } from '../vault/vault-types.js';

/** SPEC §4.2. Sample data is not a class: it keeps the class of where it lives. */
export type ContentClass =
  | 'user' // 0 Inbox, 1 Projects, 2 Areas, Daily, root-level .md, any other user folder
  | 'archived' // 4 Archive
  | 'template' // Templates
  | 'source' // 3 Resources (raw sources)
  | 'wiki' // wiki/** except the control docs
  | 'control' // CLAUDE.md, wiki/index.md, wiki/log.md
  | 'attachment'; // Attachments/** and every non-.md file outside 3 Resources

export interface ParsedFrontmatter {
  present: boolean;
  /** YAML text between the fences (no fences), exactly as in the file. null when absent. */
  raw: string | null;
  /** Parsed mapping; null when absent, invalid, or not a mapping. */
  data: Record<string, unknown> | null;
  /** Parse error message when the YAML is invalid (displayed raw, never auto-fixed). */
  error: string | null;
  /** 1-based line numbers of the opening and closing `---` (0 when absent). */
  startLine: number;
  endLine: number;
}

export interface ParsedLink {
  kind: 'wikilink' | 'embed' | 'markdown';
  /** Exact source text, e.g. `![[Bài 1#Ý chính|xem]]` or `[text](../a.md)`. */
  raw: string;
  /** Link target without heading/alias, trimmed; for markdown links the decoded URL path. */
  target: string;
  heading: string | null;
  alias: string | null;
  /** UTF-16 offsets of `raw` in the whole file content. */
  start: number;
  end: number;
  /** 1-based line of `start`. */
  line: number;
  /** Front-matter key when the link sits inside the YAML block (e.g. `course`), else null. */
  frontmatterKey: string | null;
}

export interface ParsedTag {
  /** As written, without `#` (e.g. `môn/giải-tích`). */
  tag: string;
  /** normalizeForIndex(tag) – comparison key. */
  norm: string;
  source: 'inline' | 'frontmatter';
  /** 1-based line (front-matter tags: the line of the `tags` key). */
  line: number;
}

export interface ParsedTask {
  /** 1-based line of the `- [ ]` item in the file. */
  line: number;
  /** The full raw line without its line ending: the `expectedText` for task patches. */
  lineText: string;
  /** Task text without list marker, checkbox and date tokens, trimmed. */
  text: string;
  done: boolean;
  /** `📅 YYYY-MM-DD` when it is a valid calendar date, else null. */
  due: string | null;
  /** `✅ YYYY-MM-DD` when valid, else null. */
  completed: string | null;
  /** Date tokens that were present but invalid (e.g. `2026-02-30`), shown as a warning badge. */
  invalidDates: string[];
}

export interface ParsedHeading {
  depth: number;
  text: string;
  line: number;
}

export interface ParsedNote {
  frontmatter: ParsedFrontmatter;
  links: ParsedLink[];
  /** Inline tags and front-matter tags; may contain duplicates (callers dedupe by `norm`). */
  tags: ParsedTag[];
  tasks: ParsedTask[];
  headings: ParsedHeading[];
  /**
   * Readable body text for full-text search and snippets: the text content of the document
   * without Markdown syntax and without the YAML block (wikilinks contribute their alias or
   * target). Code content is included.
   */
  plainText: string;
  wordCount: number;
  /** Dominant line ending of the file. */
  lineEnding: '\n' | '\r\n';
}

/** Lookup structure for link resolution, built from every file path in the vault. */
export interface LinkCatalog {
  /** All note paths (`.md`) that can be link targets (templates excluded from title lookup). */
  readonly notePaths: ReadonlySet<VaultPath>;
  /** All non-note file paths (attachments, sources). */
  readonly filePaths: ReadonlySet<VaultPath>;
}

export type LinkResolution =
  | { status: 'resolved'; path: VaultPath }
  | { status: 'ambiguous'; candidates: VaultPath[] }
  | { status: 'ghost' };
