import type { JournalOp, JournalStatus, TrashEntry, VaultPath } from './vault-types.js';

export type JournalStepKind = 'write' | 'rename' | 'trash' | 'restore';

/**
 * One file change of a journaled operation. The file moves from a "from" place to a "to" place
 * (both the same for `write`):
 * - write: `path` rewritten from `expectedRevision` to `afterRevision` (`before`/`after` copies).
 * - rename: `path` → `newPath`; `viaTemp` names the interim entry of a case-only or NFC-only rename.
 * - trash: `path` → `trash/<id>/files/<path>`.
 * - restore: `trash/<id>/files/<path>` → `newPath` (the original path or a ` (restored)` variant).
 * Moves keep the bytes, so `afterRevision` equals `expectedRevision` and no copies are stored.
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
  applied: boolean;
}

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
