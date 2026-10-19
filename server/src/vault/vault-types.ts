/**
 * Public contract of the vault layer (SPEC §4.1, §4.9–§4.13, F1). Every read and write of user
 * data goes through a VaultService; routes, the indexer, sample data and (later) MCP never touch
 * `fs` for vault files directly.
 *
 * Paths in this API are **vault paths**: vault-relative, forward slashes, NFC-normalized, no
 * leading slash, never inside `.secondbrain/` or `.git/`. The service maps them to the real
 * on-disk names (which may be NFD or differ in case on Windows).
 */

import type { VaultEditingOperations } from './vault-operation-types.js';

export type {
  VaultEditingOperations,
  ConflictCopyResult,
  FolderRenameResult,
  FolderTrashResult,
  PatchedNote,
  PatchPlanner,
  RenamePreview,
} from './vault-operation-types.js';

export type VaultErrorCode =
  | 'NOT_FOUND'
  | 'EXISTS'
  | 'CONFLICT'
  | 'INVALID_PATH'
  | 'VALIDATION'
  | 'WRITE_FAILED'
  | 'FORBIDDEN';

/**
 * Typed failure of a vault operation. `details` by code:
 * - CONFLICT: `{ path, currentRevision: string | null, currentContent?: string }`
 *   (`currentRevision` null = the file no longer exists; content only for UTF-8 text files)
 * - EXISTS: `{ path }`
 * - NOT_FOUND: `{ path }`
 * - INVALID_PATH: `{ path, reason }` (reason is a short machine word, e.g. `dotdot`, `reserved-name`)
 * - WRITE_FAILED: `{ path, cause }` (cause = Node error code such as `ENOSPC`, `EACCES`, `EPERM`)
 * - Journal conflicts (undo/complete): `{ journalId, conflicts: [{ path, expectedRevision, currentRevision }] }`
 */
export class VaultError extends Error {
  constructor(
    readonly code: VaultErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'VaultError';
  }
}

export function isVaultError(error: unknown): error is VaultError {
  return error instanceof VaultError;
}

/** Vault-relative path (see file comment). */
export type VaultPath = string;

export interface FileStat {
  path: VaultPath;
  size: number;
  mtimeMs: number;
}

export interface VaultListing {
  /** Every regular file outside `.secondbrain/` and `.git/` (notes, attachments, sources…). */
  files: FileStat[];
  /** Every folder (including empty ones), excluding the vault root itself. */
  folders: VaultPath[];
}

export interface NoteRead {
  path: VaultPath;
  /** UTF-8 decoded content, byte-for-byte what is on disk (BOM and CRLF preserved). */
  content: string;
  /** SHA-256 of the file bytes, lowercase hex (SPEC §4.10). */
  revision: string;
  mtimeMs: number;
  size: number;
  /**
   * false when the bytes are not valid UTF-8 (e.g. an ANSI file from an old editor): `content`
   * is then a lossy decode, and write/patch/relink refuse to rewrite the file (VALIDATION with
   * `reason: 'not-utf8'`) so untouched bytes are never replaced by U+FFFD.
   */
  utf8: boolean;
}

export interface BytesRead {
  path: VaultPath;
  bytes: Buffer;
  revision: string;
  mtimeMs: number;
  size: number;
}

export interface WriteResult {
  path: VaultPath;
  revision: string;
  mtimeMs: number;
}

/** Replace `[start, end)` (UTF-16 offsets into the content at `expectedRevision`) with `text`. */
export interface TextRangePatch {
  start: number;
  end: number;
  text: string;
}

export interface MultiFileResult {
  journalId: string;
  /** New path of the renamed/moved note. */
  path: VaultPath;
  revision: string;
  /** Other notes rewritten by relink (their pre-operation paths). */
  affected: VaultPath[];
  /**
   * Notes whose links to the renamed note were left as they are because the files are not valid
   * UTF-8 (rewriting them would re-encode bytes nobody edited). Present only when non-empty.
   */
  skipped?: VaultPath[];
  /**
   * Links that had to change but could not be rewritten so that they still resolve (e.g. the new
   * title contains `#` or brackets); left as they are, now unresolved. Present only when non-empty.
   */
  unresolvable?: UnresolvableRelink[];
}

export interface UnresolvableRelink {
  /** The linking note (pre-operation path). */
  path: VaultPath;
  raw: string;
  line: number;
}

/**
 * Changes made through this service (origin `app`). The watcher reports outside edits with the
 * same shapes and origin `external`. Listeners must not throw; they run after the write is durable.
 */
export type VaultChange =
  | { kind: 'created'; path: VaultPath; revision: string; origin: ChangeOrigin }
  | { kind: 'written'; path: VaultPath; revision: string; origin: ChangeOrigin }
  | { kind: 'deleted'; path: VaultPath; origin: ChangeOrigin }
  | { kind: 'renamed'; path: VaultPath; oldPath: VaultPath; revision: string; origin: ChangeOrigin }
  | { kind: 'folder-created'; path: VaultPath; origin: ChangeOrigin }
  | { kind: 'folder-deleted'; path: VaultPath; origin: ChangeOrigin };

export type ChangeOrigin = 'app' | 'external';

/** One file rewrite planned by relink (SPEC F4): applied atomically and journaled. */
export interface RelinkEdit {
  path: VaultPath;
  expectedRevision: string;
  newContent: string;
}

/**
 * Supplies the link rewrites for a rename/move. Called inside the write queue BEFORE any file is
 * touched, so it sees the pre-operation state (SPEC §4.4, F4). Implemented on top of the index.
 */
export interface RelinkPlanner {
  plan(op: {
    kind: 'rename' | 'move';
    from: VaultPath;
    to: VaultPath;
  }): Promise<RelinkEdit[] | RelinkPlan>;
  /** Same rules for files moving together (a folder rename). Without it nothing is relinked. */
  planMoves?(moves: { from: VaultPath; to: VaultPath }[]): Promise<RelinkPlan>;
}

/** Planner result with the notes it deliberately left unchanged (see `MultiFileResult.skipped`). */
export interface RelinkPlan {
  edits: RelinkEdit[];
  skipped: VaultPath[];
  unresolvable?: UnresolvableRelink[];
}

export type TrashReason = 'user' | 'conflict' | 'sample-data' | 'restore-collision';

/** `vault/.secondbrain/trash/<id>/meta.json` (SPEC §4.11). */
export interface TrashMeta {
  opId: string;
  originalPaths: VaultPath[];
  reason: TrashReason;
  deletedAt: string;
  /** A trashed folder and its subfolders (parents first): restore re-creates them, empty or not. */
  folders?: VaultPath[];
}

export interface TrashEntry extends TrashMeta {
  id: string;
}

export type JournalOp =
  'rename' | 'move' | 'trash' | 'restore' | 'reschedule' | 'folder-rename' | 'folder-trash';
/** `undoing`: an undo was interrupted; still pending, and both "complete" and "undo" resume it. */
export type JournalStatus = 'planned' | 'running' | 'done' | 'failed' | 'undone' | 'undoing';

/** What the UI shows for an operation that did not finish (SPEC §4.12, design.md §7). */
export interface PendingJournalEntry {
  id: string;
  op: JournalOp;
  status: JournalStatus;
  createdAt: string;
  totalSteps: number;
  appliedSteps: number;
  paths: VaultPath[];
}

export interface VaultStatePaths {
  /** `<vault>/.secondbrain` */
  appDir: string;
  /** `<vault>/.secondbrain/vault.json` */
  vaultFile: string;
  /** derived, deletable */
  cacheDir: string;
  /** durable */
  stateDir: string;
  journalDir: string;
  draftsDir: string;
  ingestDir: string;
  trashDir: string;
  logsDir: string;
  /** `<vault>/.secondbrain/state/events.jsonl` */
  eventsFile: string;
  /** `<vault>/.secondbrain/state/sample.json` */
  sampleFile: string;
}

/** The vault service; the editor-era operations (previews, folders, …) are in VaultEditingOperations. */
export interface VaultService extends VaultEditingOperations {
  /** Absolute real path of the vault root. */
  readonly root: string;
  /** Identity from `vault.json` (uuid). */
  readonly id: string;
  readonly paths: VaultStatePaths;

  list(): Promise<VaultListing>;
  /** null when the path does not exist (or is a folder). Throws INVALID_PATH for bad paths. */
  stat(path: VaultPath): Promise<FileStat | null>;
  read(path: VaultPath): Promise<NoteRead>;
  readBytes(path: VaultPath): Promise<BytesRead>;
  /** Guarded absolute disk path of an existing file (for streaming in GET /files). */
  resolveExisting(path: VaultPath): Promise<string>;

  /** Creates a new file; EXISTS if the path (or a case/NFC variant on Windows) exists. */
  create(path: VaultPath, content: string | Uint8Array): Promise<WriteResult>;
  /**
   * Like create(), but when the name is taken appends ` 2`, ` 3`, … before the extension
   * (SPEC F12.2, F15.1). Returns the path actually used.
   */
  createUnique(path: VaultPath, content: string | Uint8Array): Promise<WriteResult>;
  createFolder(path: VaultPath): Promise<void>;
  /** Full replace at a revision (PUT /note). CONFLICT when the disk revision differs. */
  write(path: VaultPath, content: string, expectedRevision: string): Promise<WriteResult>;
  /** Text patches on the raw file at a revision; patches must not overlap. */
  patch(path: VaultPath, patches: TextRangePatch[], expectedRevision: string): Promise<WriteResult>;
  /** Rename (same or other folder), optionally rewriting links through the RelinkPlanner. Journaled. */
  rename(
    path: VaultPath,
    newPath: VaultPath,
    options: { expectedRevision: string; relink: boolean },
  ): Promise<MultiFileResult>;
  /** Move into `folder` keeping the file name. Journaled. */
  move(
    path: VaultPath,
    folder: VaultPath,
    options: { expectedRevision: string; relink: boolean },
  ): Promise<MultiFileResult>;
  /** Moves files to the trash (never unlinks). Journaled; one trash entry for the whole call. */
  trash(
    paths: VaultPath[],
    expectedRevisions: string[],
    reason?: TrashReason,
  ): Promise<{ journalId: string; trashId: string }>;
  /** Restores a trash entry to its original paths; collisions get a ` (restored)` suffix. */
  restore(
    trashId: string,
  ): Promise<{ journalId: string; restored: { from: VaultPath; to: VaultPath }[] }>;
  listTrash(): Promise<TrashEntry[]>;
  /** Permanently removes trash entries older than `maxAgeDays`. Returns how many were removed. */
  purgeTrash(maxAgeDays: number, now?: Date): Promise<number>;

  pendingJournal(): Promise<PendingJournalEntry[]>;
  /** Finishes an interrupted operation (re-checks revisions of the remaining steps). */
  completeJournal(id: string): Promise<void>;
  /** Reverts a done or interrupted operation using its saved `before` copies (revision-checked). */
  undoJournal(id: string): Promise<void>;

  onChange(listener: (change: VaultChange) => void): () => void;
  setRelinkPlanner(planner: RelinkPlanner | null): void;
  /** Waits for queued writes to finish; later calls fail. */
  close(): Promise<void>;
}
