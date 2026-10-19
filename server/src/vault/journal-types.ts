import type { JournalOp, JournalStatus, TrashEntry, VaultPath } from './vault-types.js';

export type JournalStepKind =
  'write' | 'rename' | 'trash' | 'restore' | 'folder-rename' | 'folder-trash';

/** A file inside a moved folder: path relative to the folder, revision when the step was planned. */
export interface FolderFile {
  path: string;
  revision: string;
}

/**
 * One file change of a journaled operation. The file moves from a "from" place to a "to" place
 * (both the same for `write`):
 * - write: `path` rewritten from `expectedRevision` to `afterRevision` (`before`/`after` copies).
 * - rename: `path` → `newPath`; `viaTemp` names the interim entry of a case-only or NFC-only rename.
 * - trash: `path` → `trash/<id>/files/<path>`.
 * - restore: `trash/<id>/files/<path>` → `newPath` (the original path or a ` (restored)` variant).
 * - folder-rename: the folder `path` → `newPath` as one directory move (`viaTemp` as for rename).
 * - folder-trash: the folder `path` → `trash/<id>/files/<path>` as one directory move.
 * Moves keep the bytes, so `afterRevision` equals `expectedRevision` and no copies are stored.
 * Folder steps carry a digest of their file list as revision and judge their state by where the
 * folder is, never by rewriting anything inside it.
 */
export interface JournalStep {
  kind: JournalStepKind;
  path: VaultPath;
  newPath?: VaultPath;
  expectedRevision: string;
  afterRevision: string;
  /** Copy refs relative to the journal's own folder (`before/<n>`, `after/<n>`), null for moves. */
  before: string | null;
  after: string | null;
  viaTemp?: string;
  /** Same-file renames only: the exact on-disk name before the rename (may be NFD). */
  fromName?: string;
  /** Folder steps only: the files and subfolders (relative paths) the move carries. */
  files?: FolderFile[];
  folders?: string[];
  applied: boolean;
}

export const FOLDER_STEP_KINDS: ReadonlySet<JournalStepKind> = new Set([
  'folder-rename',
  'folder-trash',
]);

export const isFolderStep = (step: JournalStep): boolean => FOLDER_STEP_KINDS.has(step.kind);

/** Steps whose "to" place is inside the operation's trash entry. */
export const movesToTrash = (step: JournalStep): boolean =>
  step.kind === 'trash' || step.kind === 'folder-trash';

/** `state/journal/<id>.json` (SPEC §4.12). */
export interface JournalEntry {
  id: string;
  op: JournalOp;
  status: JournalStatus;
  createdAt: string;
  updatedAt: string;
  steps: JournalStep[];
  /** Trash entry involved in a trash/restore op, kept so an undo can recreate its meta.json. */
  trash?: TrashEntry;
}

export const PENDING_STATUSES: ReadonlySet<JournalStatus> = new Set([
  'planned',
  'running',
  'failed',
  'undoing',
]);
