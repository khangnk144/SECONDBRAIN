/** Shapes of one open note's session (SPEC §4.10, §5): what the screen reads and what it needs. */
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import type { ContentClass, VaultPath } from '../../lib/api/vault-types';
import type {
  CreateNoteRequest,
  CreateNoteResponse,
  FrontmatterPatchRequest,
  FrontmatterPatchResponse,
  NoteResponse,
  SaveNoteRequest,
  SaveNoteResponse,
} from '../../lib/api/notes-types';
import type { OperationResult, RevisionOption } from '../../lib/operation-result';
import type { DraftStorage } from '../drafts/draft-store';
import type { MarkdownSnapshot } from '../../editor/markdown/markdown-document';
import type { SaveErrorKind } from './save-errors';
import type { SourceBase } from './source-text';

/**
 * - `loading` until the first read; `clean` = the editor shows the disk text;
 * - `dirty` = unsaved edits not yet in a draft, `draft` = unsaved edits kept as a draft;
 * - `saving` = a write is on its way; `saved` = the server confirmed the new revision;
 * - `error` = the last write failed (retried automatically); `conflict` = the disk changed too.
 */
export type SaveStatus =
  'loading' | 'clean' | 'dirty' | 'saving' | 'saved' | 'draft' | 'error' | 'conflict';

/** The note could not be opened at all (no draft to show either). */
export type LoadProblem = 'not-found' | 'failed' | null;

/** The three versions of SPEC §4.10. */
export interface ConflictVersions {
  /** What the editor was based on; null when unknown (a draft from an older revision). */
  base: string | null;
  /** The disk now: null = the file was deleted; `text` null = not readable as UTF-8 text. */
  disk: { revision: string; text: string | null } | null;
  /** The text of record of the editor. */
  mine: string;
  /** Revision `mine` was typed on (kept with its draft so a reopen still sees the conflict). */
  mineBaseRevision: string | null;
  /** Set when "mine" is a version "Tải lại" set aside earlier, being looked at again. */
  keptId?: number;
}

export interface SourceModeView {
  /** The text shown in the textarea (`\n` line endings, no BOM). */
  text: string;
}

export interface SessionView {
  path: VaultPath;
  status: SaveStatus;
  loadProblem: LoadProblem;
  errorKind: SaveErrorKind | null;
  /** Not UTF-8: shown, never written. */
  readOnly: boolean;
  noteClass: ContentClass | null;
  /** Front matter of the text of record, fences included; null when the note has none. */
  frontmatterRaw: string | null;
  /** The document the editor shows; null while loading. */
  doc: ProseMirrorNode | null;
  /** Bumped when the session replaced `doc` itself (reload, draft discard, source mode). */
  docVersion: number;
  keepSelection: boolean;
  /** A draft was restored on open (banner with "Bỏ bản nháp"). */
  draftRestored: boolean;
  /** Versions "Tải lại" set aside for this note. */
  keptCount: number;
  conflict: ConflictVersions | null;
  source: SourceModeView | null;
}

export type FrontmatterChange = Pick<FrontmatterPatchRequest, 'set' | 'unset'>;

/** Things the session tells the user about (toasts) – translated by the screen layer. */
export type SessionNotice =
  | { kind: 'reloaded' }
  | { kind: 'kept-mine' }
  | { kind: 'kept-discarded' }
  | { kind: 'keep-aside-failed' }
  | { kind: 'disk-changed-again' }
  | { kind: 'action-failed'; error: unknown }
  | { kind: 'patch-failed'; error: unknown };

export interface SessionApi {
  getNote(path: VaultPath): Promise<NoteResponse>;
  putNote(body: SaveNoteRequest): Promise<SaveNoteResponse>;
  postNote(body: CreateNoteRequest): Promise<CreateNoteResponse>;
  patchNoteFrontmatter(body: FrontmatterPatchRequest): Promise<FrontmatterPatchResponse>;
}

export interface SessionDeps {
  api: SessionApi;
  drafts: DraftStorage;
  renameNote(path: VaultPath, title: string, options: RevisionOption): Promise<OperationResult>;
  notify(notice: SessionNotice): void;
  schema: Schema;
  now(): number;
  /** This browser window's id: drafts are kept per window (see draft-store). */
  windowId: string;
}

export interface SourceState {
  base: SourceBase;
  display: string;
  /** File text of record while in source mode. */
  fileText: string;
  /** File text when source mode was entered (unchanged → keep the document as it was). */
  entryText: string;
}

export interface RecordText {
  text: string;
  /** Snapshot describing `text` (null in source mode). */
  snapshot: MarkdownSnapshot | null;
  exact: boolean;
}
