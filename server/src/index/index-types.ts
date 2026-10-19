/**
 * Public contract of the index layer (SPEC §4.7, §4.14, §4.15, F8, F9). The index is derived
 * data in `vault/.secondbrain/cache/index.sqlite`; it can always be rebuilt from the files.
 * Queries are synchronous (better-sqlite3); mutations are async because they read files.
 */
import type { ContentClass, LinkCatalog } from '../markdown/markdown-types.js';
import type { VaultPath } from '../vault/vault-types.js';
import type { LinkTargets } from './link-target-list.js';

export interface IndexedNote {
  path: VaultPath;
  title: string;
  /** First path segment ('' for root-level notes). */
  folder: string;
  class: ContentClass;
  type: string | null;
  status: string | null;
  /** Valid `deadline:` calendar date (YYYY-MM-DD) or null. */
  deadline: string | null;
  created: string | null;
  mtimeMs: number;
  size: number;
  revision: string;
  frontmatter: Record<string, unknown> | null;
  frontmatterError: string | null;
  wordCount: number;
}

export interface BacklinkRef {
  fromPath: VaultPath;
  fromTitle: string;
  line: number;
  /** The line containing the link, trimmed to ≤ 160 characters around the link. */
  context: string;
  /** `[start, end)` of the link inside `context` (UTF-16 offsets). */
  highlight: [number, number];
}

export interface OutlinkRef {
  raw: string;
  target: string;
  line: number;
  /** Resolved target path, null for ghost and ambiguous links. */
  toPath: VaultPath | null;
  ambiguous: boolean;
}

export interface TagCount {
  /** Display form (the first spelling seen). */
  tag: string;
  norm: string;
  /** Number of notes carrying the tag (inline and front matter count once per note). */
  count: number;
}

export interface SearchQuery {
  /** Free text; may also contain filter tokens `tag:` `folder:` `type:` `due:` `class:`. */
  q: string;
  tag?: string;
  folder?: string;
  type?: string;
  due?: '7d' | '30d' | 'overdue';
  /** `archive` includes archived notes in due/task filters (they are always in text search). */
  class?: 'archive';
  limit?: number;
}

export interface SearchSnippet {
  /** Excerpt of the ORIGINAL text (diacritics intact). */
  text: string;
  /** [start, end) UTF-16 ranges inside `text` matching query terms (diacritic-insensitive). */
  highlights: [number, number][];
}

export interface SearchResult {
  path: VaultPath;
  title: string;
  folder: string;
  class: ContentClass;
  matchedIn: 'title' | 'body' | 'filter' | 'recent';
  snippet: SearchSnippet | null;
  /** Higher is better; title matches always rank above body-only matches. */
  score: number;
}

export interface RebuildProgress {
  phase: 'scan' | 'index' | 'swap' | 'done';
  done: number;
  total: number;
}

export interface IndexService {
  /**
   * Opens the index; rebuilds into a new file + atomic swap when the file is missing, corrupt or
   * has another schema version; then reconciles it with the files on disk (changes made while
   * the app was closed). Returns why a rebuild happened, if it did.
   */
  open(): Promise<{ rebuilt: boolean; reason: 'missing' | 'corrupt' | 'schema' | null }>;
  /** (Re)indexes one file after a create/modify. Idempotent on revision. */
  updateFile(path: VaultPath): Promise<void>;
  removeFile(path: VaultPath): Promise<void>;
  renameFile(oldPath: VaultPath, newPath: VaultPath): Promise<void>;
  /** Re-scans the whole vault against the index (used after a watcher error/overflow). */
  reconcile(): Promise<void>;
  /**
   * Full rebuild into a new database file, then atomic swap. Queries keep using the old index
   * until the swap; file changes arriving meanwhile are queued and applied after it.
   */
  rebuild(onProgress?: (progress: RebuildProgress) => void): Promise<void>;
  isRebuilding(): boolean;

  getNote(path: VaultPath): IndexedNote | null;
  listNotes(): IndexedNote[];
  backlinks(path: VaultPath): BacklinkRef[];
  outlinks(path: VaultPath): OutlinkRef[];
  noteTags(path: VaultPath): string[];
  tags(): TagCount[];
  /** Catalog of every indexed path for link resolution (relink, autocomplete). */
  linkCatalog(): LinkCatalog;
  /** Notes having at least one link that resolves to `path` (unambiguously). */
  linkingNotes(path: VaultPath): VaultPath[];
  /**
   * Notes holding a link whose target names any of `paths` by title, path or file name –
   * resolved, ambiguous or ghost (relink: a rename INTO an existing title must see the links
   * that use that title today). May include a few extra notes; never misses one.
   */
  notesLinkingByTitleOrPath(paths: VaultPath[]): VaultPath[];
  /** Resolves once every index change queued so far (and any queued meanwhile) is applied. */
  settled(): Promise<void>;
  /** Every note and other file a link can target (F4 autocomplete). */
  linkTargets(): LinkTargets;
  /**
   * Searchable notes whose body text holds the words of `text` in sequence (normalized, FTS);
   * candidates for unlinked mentions, sorted by path. May include extra notes, never misses one.
   */
  notesContainingPhrase(text: string): VaultPath[];
  search(query: SearchQuery): SearchResult[];

  /** Raw task rows for the deadline service (all classes; the service filters). */
  allTasks(): IndexedTask[];
  /**
   * The rows the deadline rules read – user and archived notes that have a deadline, are a
   * project or hold tasks, and all their tasks – without loading every note. Optional so test
   * doubles need not implement it; the deadline service falls back to listNotes()/allTasks().
   */
  deadlineRows?(): DeadlineRows;
  close(): void;
}

export interface DeadlineRows {
  notes: Pick<IndexedNote, 'path' | 'title' | 'class' | 'type' | 'status' | 'deadline'>[];
  tasks: IndexedTask[];
}

export interface IndexedTask {
  path: VaultPath;
  line: number;
  lineText: string;
  text: string;
  done: boolean;
  due: string | null;
  completed: string | null;
  invalidDates: string[];
}

export type Urgency = 'done' | 'urgent' | 'soon' | 'ok';

/** SPEC §4.7. Only user notes produce items (archived ones only when explicitly included). */
export interface DeadlineItem {
  /** `note:<path>` or `task:<path>#<line>`. */
  id: string;
  kind: 'note' | 'task';
  /** Note title, or task text without tokens. */
  title: string;
  /** Due calendar date YYYY-MM-DD (local). */
  date: string;
  path: VaultPath;
  noteTitle: string;
  line: number | null;
  /** Expected line text for task patches (tasks only). */
  lineText: string | null;
  done: boolean;
  urgency: Urgency;
  /** Calendar days from today (negative = overdue). */
  daysLeft: number;
  class: ContentClass;
}

export type { LinkTargetFile, LinkTargetNote, LinkTargets } from './link-target-list.js';

// Shapes of the deadline service (Today, Calendar, Tasks), kept in their own file for size.
export type {
  CalendarView,
  DeadlineQueryOptions,
  DeadlineService,
  ProjectSummary,
  TaskEntry,
  TaskGroups,
  TodayView,
} from './deadline-types.js';
