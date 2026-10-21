/**
 * Result shapes of the vault operations added for the editor milestone (previews, folder
 * operations, conflict copies, computed patches). Part of the VaultService contract in
 * `vault-types.ts`, kept here so that file stays readable.
 */
import type { TextRangePatch, UnresolvableRelink, VaultPath, WriteResult } from './vault-types.js';

/** What a rename/move would do, computed by the same planner and checks; nothing is changed. */
export interface RenamePreview {
  dryRun: true;
  /** Where the note or folder would end up. */
  path: VaultPath;
  /** Notes whose links would be rewritten (their current paths). */
  affected: VaultPath[];
  skipped?: VaultPath[];
  unresolvable?: UnresolvableRelink[];
}

export interface FolderRenameResult {
  journalId: string;
  /** New path of the folder. */
  path: VaultPath;
  /** Notes whose links were rewritten (their paths before the operation). */
  affected: VaultPath[];
  skipped?: VaultPath[];
  unresolvable?: UnresolvableRelink[];
}

export interface FolderTrashResult {
  journalId: string;
  trashId: string;
  /** The files that went to the trash (their vault paths); empty for an empty folder. */
  paths: VaultPath[];
}

export interface PatchedNote extends WriteResult {
  /** The full content now on disk. */
  content: string;
}

export interface ConflictCopyResult extends WriteResult {
  /** Trash entry (`reason: 'conflict'`) holding the version that was on disk before. */
  trashId: string;
}

/**
 * Computes text patches from the content at the expected revision (inside the write queue, so
 * the patches always match the bytes they replace). May throw a VaultError to refuse.
 */
export type PatchPlanner = (content: string) => TextRangePatch[];

/** Journal op kinds of single-file content rewrites. */
export type JournaledRewriteOp = 'reschedule';

export interface JournaledRewrite {
  path: VaultPath;
  revision: string;
  /** The full content now on disk. */
  content: string;
  /** Journal entry to undo the rewrite; null when nothing changed (no entry, no write). */
  journalId: string | null;
}

/** Operations of the VaultService added for the editor: previews, patches, folders, reveal. */
export interface VaultEditingOperations {
  /** An existing file or folder with its guarded absolute path (reveal); NOT_FOUND otherwise. */
  resolveEntry(path: VaultPath): Promise<{ path: VaultPath; abs: string; kind: 'file' | 'dir' }>;
  /** What rename() would do (same checks, same planner); changes nothing. */
  previewRename(
    path: VaultPath,
    newPath: VaultPath,
    options: { expectedRevision: string; relink: boolean },
  ): Promise<RenamePreview>;
  previewMove(
    path: VaultPath,
    folder: VaultPath,
    options: { expectedRevision: string; relink: boolean },
  ): Promise<RenamePreview>;
  /** Text patches computed from the content at `expectedRevision`, applied atomically. */
  patchWith(path: VaultPath, expectedRevision: string, plan: PatchPlanner): Promise<PatchedNote>;
  /** Like patchWith, recorded as a one-step journal entry so it can be undone. */
  rewriteJournaled(
    path: VaultPath,
    expectedRevision: string,
    plan: PatchPlanner,
    op: JournaledRewriteOp,
  ): Promise<JournaledRewrite>;
  /**
   * Full replace at the CURRENT revision after copying the bytes on disk into a trash entry with
   * `reason: 'conflict'` ("keep mine" of the conflict UI, SPEC §4.10) or `'history-restore'`.
   */
  writeKeepingConflictCopy(
    path: VaultPath,
    content: string,
    expectedRevision: string,
    reason?: 'conflict' | 'history-restore',
  ): Promise<ConflictCopyResult>;
  /** Renames or moves a folder with everything in it, relinking like rename(). Journaled. */
  renameFolder(
    path: VaultPath,
    newPath: VaultPath,
    options: { relink: boolean },
  ): Promise<FolderRenameResult>;
  previewRenameFolder(
    path: VaultPath,
    newPath: VaultPath,
    options: { relink: boolean },
  ): Promise<RenamePreview>;
  /** Moves a folder and everything below it into one trash entry. Journaled. */
  trashFolder(path: VaultPath): Promise<FolderTrashResult>;
}
