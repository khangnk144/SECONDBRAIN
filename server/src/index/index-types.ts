/**
 * Public contract of the index layer (SPEC §4.7, §4.14, §4.15, F8, F9). The index is derived
 * data in `vault/.secondbrain/cache/index.sqlite`; it can always be rebuilt from the files.
 * Queries are synchronous (better-sqlite3); mutations are async because they read files.
 */
import type { ContentClass, LinkCatalog } from '../markdown/markdown-types.js';
import type { VaultPath } from '../vault/vault-types.js';
import type { ActivityNoteRow, DoneTaskRow } from './activity-rows.js';
import type { LinkTargets } from './link-target-list.js';
import type { GraphRows } from './view-row-queries.js';

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
  /** PDF results only: the best-matching page (1-based); the snippet comes from it. */
  page?: number;
}

/** `IndexService.retrieve` input (AI retrieval, SPEC F33 "BM25 always"). */
export interface RetrievalQuery {
  /** The question; normalized, stop words dropped, remaining terms OR-combined. */
  text: string;
  /** At most this many hits (clamped to 1…200). */
  limit: number;
  /** Include PDF page hits (`3 Resources` PDFs). Default false. */
  includePdf?: boolean;
}

export interface RetrievalHit {
  path: VaultPath;
  title: string;
  class: ContentClass;
  /** Best-matching PDF page (one hit per PDF); null for notes. */
  page: number | null;
  /** bm25 relevance, higher is better (notes and PDF pages on one scale, see `retrieve`). */
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
  /**
   * Every note's tags in one query (path → tags in note order), for answers that need all of
   * them (the graph's node facts). Optional so test doubles need not implement it.
   */
  noteTagsByPath?(): Map<VaultPath, string[]>;
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
  /**
   * Changes whenever what the queries answer may have changed (a change task started or ended,
   * a rebuild swapped the database): equal stamps mean equal answers, so a caller may keep a
   * built answer (the graph). Optional so test doubles need not implement it (no caching then).
   */
  changeStamp?(): string;
  /** Every note and other file a link can target (F4 autocomplete). */
  linkTargets(): LinkTargets;
  /**
   * Searchable notes whose body text holds the words of `text` in sequence (normalized, FTS);
   * candidates for unlinked mentions, sorted by path. May include extra notes, never misses one.
   */
  notesContainingPhrase(text: string): VaultPath[];
  search(query: SearchQuery): SearchResult[];
  /**
   * OR-semantics BM25 candidates for AI retrieval over searchable classes (no folder scope: the
   * AI layer filters by scope). Never throws on odd input (FTS syntax is never passed through).
   */
  retrieve(query: RetrievalQuery): RetrievalHit[];
  /**
   * Stores the page text of a PDF (`pages[i]` = page i + 1) for search and retrieval; `null`
   * removes it. Ignored for files that are not PDFs of a searchable class or are not indexed.
   * Applied in order with file changes (after a running rebuild, like them).
   */
  setSourceText(
    path: VaultPath,
    contentHash: string,
    pages: readonly string[] | null,
  ): Promise<void>;
  /** Content hash of the PDF text the index holds for `path`, or null. */
  sourceTextHash(path: VaultPath): string | null;

  /** Raw task rows for the deadline service (all classes; the service filters). */
  allTasks(): IndexedTask[];
  /**
   * The rows the deadline rules read – user and archived notes that have a deadline, are a
   * project or hold tasks, and all their tasks – without loading every note. Optional so test
   * doubles need not implement it; the deadline service falls back to listNotes()/allTasks().
   */
  deadlineRows?(): DeadlineRows;
  /** Note and file rows plus resolved links, for the graph (F16). */
  graphRows(): GraphRows;
  /** Paths of the notes in the `Daily` folder (prev/next daily navigation, F13.3). */
  dailyNotePaths(): VaultPath[];
  /** Notes of the classes whose touches count for activity (user, archived, wiki). */
  activityNotes(): ActivityNoteRow[];
  /** Done tasks (`✅` date in `[from, to]`) of user notes, newest first (activity service). */
  doneTasksBetween(from: string, to: string): DoneTaskRow[];
  close(): void;
}

export interface DeadlineRows {
  notes: Pick<
    IndexedNote,
    'path' | 'title' | 'class' | 'type' | 'status' | 'deadline' | 'revision'
  >[];
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

export type { LinkTargetFile, LinkTargetNote, LinkTargets } from './link-target-list.js';

// Shapes of the deadline service (Today, Calendar, Tasks), kept in their own file for size.
export type {
  CalendarView,
  DeadlineItem,
  DeadlineQueryOptions,
  DeadlineService,
  ProjectSummary,
  TaskEntry,
  TaskGroups,
  TodayView,
  Urgency,
} from './deadline-types.js';

// M5 (F35.9, F24.4): the activity part of `GET /api/today`, built in `today-activity.ts`.

/** A note on Today's "Não hôm nay" map; `group` is the brain map's colour group. */
export interface TodayBrainNode {
  path: VaultPath;
  title: string;
  group: 'projects' | 'areas' | 'resources' | 'wiki' | 'daily' | 'other';
}

/** A resolved link between two nodes of the map; `from` is the linking note. */
export interface TodayBrainEdge {
  from: VaultPath;
  to: VaultPath;
}

export interface TodayBrain {
  /** Notes created today (current paths; deleted ones dropped). */
  notesNew: number;
  /** Notes created or edited today (the same count as today's "7 ngày ghi chép" bar). */
  notesTouched: number;
  /** Unique linking-note → target pairs of today's `link_added` lines. */
  linksAdded: number;
  /** Pages the AI wrote today: outputs of today's succeeded ingest runs (F34). */
  aiTouched: number;
  /** At most 24 notes touched, linked or AI-written today, most connected first. */
  nodes: TodayBrainNode[];
  edges: TodayBrainEdge[];
}

export interface TodayActivity {
  /** The 7 local days ending today, oldest first: notes created or edited that day. */
  days: { date: string; count: number }[];
  /** Tasks with `✅` = yesterday in user notes. */
  doneYesterday: number;
  brain: TodayBrain;
}
