/**
 * One open note: its text of record, autosave, drafts, conflicts and outside changes behind a
 * small API for the note screen. Every operation that talks to the server runs in one queue per
 * note (SPEC §4.10: each request carries the revision the previous one produced).
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { caretForSourceOffset, type CaretTarget } from '../../editor/markdown/source-offset-caret';
import type { VaultPath } from '../../lib/api/vault-types';
import { sameWithoutEmptyParagraphs } from './empty-paragraphs';
import type { OperationResult } from '../../lib/operation-result';
import { subscribeServerEvent } from '../../lib/ws/server-event-bus';
import { blockIndexForLine } from './line-to-block';
import type { FrontmatterChange, SessionDeps, SessionView } from './note-session-types';
import { keepMine, reloadFromDisk } from './session-conflict';
import { SessionCore } from './session-core';
import { patchFrontmatterInQueue } from './session-frontmatter';
import { openSession } from './session-open';
import { handleServerEvent } from './session-outside-changes';
import { closeKeptReview, reviewKept } from './session-kept-review';
import { renameInQueue } from './session-rename';
import { saveInQueue } from './session-save';
import { enterSourceMode, leaveSourceMode, sourceChanged } from './session-source-mode';

export interface NoteSession {
  /** Unique per session object (React key for the editor of this note). */
  readonly id: number;
  readonly vaultId: string;
  path(): VaultPath;
  getView(): SessionView;
  subscribe(listener: () => void): () => void;
  open(): Promise<void>;
  /** "Thử lại" after a failed open: opens again (nothing happens once the note is open). */
  retryOpen(): void;
  /** Every doc-changing editor transaction. */
  docChanged(doc: ProseMirrorNode): void;
  /** Saves now; resolves true when the disk holds the text of record. */
  flush(): Promise<boolean>;
  retry(): void;
  /** Source mode switches run in the note's queue, after any save or patch on its way. */
  setSourceMode(on: boolean): Promise<void>;
  toggleSourceMode(): Promise<void>;
  sourceChanged(text: string): void;
  /** Flushes pending edits first, then patches the front matter at the new base revision. */
  patchFrontmatter(change: FrontmatterChange): Promise<boolean>;
  /** Flushes pending edits first, then renames with relink (dry run, confirm, undo toast). */
  rename(title: string): Promise<OperationResult>;
  discardDraft(): Promise<void>;
  reloadFromDisk(): Promise<void>;
  keepMine(): Promise<void>;
  /** Opens the newest version "Tải lại" set aside, against the disk, on the conflict screen. */
  reviewKept(): Promise<void>;
  closeKeptReview(): Promise<void>;
  hasUnsavedChanges(): boolean;
  /** Writes the draft now (page about to be hidden). */
  flushDraft(): void;
  /** Top-level block for a 1-based file line, when the document still matches its snapshot. */
  blockForLine(line: number): number | null;
  /** Where the caret goes for a UTF-16 offset in the file (a template's `{{cursor}}`). */
  caretForOffset(offset: number): CaretTarget | null;
  onPathChange(listener: (oldPath: VaultPath, newPath: VaultPath) => void): void;
  dispose(): void;
}

let nextSessionId = 1;

export function createNoteSession(
  deps: SessionDeps,
  vaultId: string,
  path: VaultPath,
): NoteSession {
  const core = new SessionCore(deps, vaultId, path);
  let saveQueued = false;
  core.requestSave = () => {
    if (saveQueued || core.disposed) return;
    saveQueued = true;
    void core.queue.run(() => {
      saveQueued = false;
      return saveInQueue(core);
    });
  };
  const run = <T>(operation: () => Promise<T>) => core.queue.run(operation);
  const retrySave = () => {
    core.clearTimer('retryTimer');
    core.requestSave();
  };
  const reopen = () =>
    void run(async () => {
      if (core.phase === 'failed' || core.phase === 'not-found') await openSession(core);
    });
  const unsubscribe = subscribeServerEvent('*', (event) =>
    handleServerEvent(core, event, { reopen, retrySave }),
  );

  return {
    id: nextSessionId++,
    vaultId,
    path: () => core.path,
    getView: () => core.view(),
    subscribe: (listener) => core.subscribe(listener),
    open: () => run(() => openSession(core)),
    retryOpen: reopen,
    docChanged(doc) {
      if (core.phase !== 'ready' || core.readOnly || core.conflict || core.source) return;
      if (doc === core.doc) return;
      // Adding or removing empty paragraphs writes no byte (Markdown has no empty paragraph):
      // the note stays as saved, without a "Bản nháp" flash.
      const unchanged = core.doc !== null && sameWithoutEmptyParagraphs(doc, core.doc);
      core.doc = doc;
      if (!unchanged) core.markChanged();
    },
    flush: () => run(() => saveInQueue(core)),
    retry: retrySave,
    setSourceMode: (on) => run(async () => (on ? enterSourceMode(core) : leaveSourceMode(core))),
    toggleSourceMode: () =>
      run(async () => (core.source ? leaveSourceMode(core) : enterSourceMode(core))),
    sourceChanged: (text) => sourceChanged(core, text),
    patchFrontmatter: (change) => run(() => patchFrontmatterInQueue(core, change)),
    rename: (title) => run(() => renameInQueue(core, title)),
    discardDraft: () =>
      run(async () => {
        const restored = core.restored;
        if (!restored || core.conflict) return;
        core.restored = null;
        core.source = null;
        core.loadDoc(restored.text);
        core.changeSeq += 1;
        core.resync();
        if (core.synced) core.removeDraft();
        core.emit();
        if (!core.synced) await saveInQueue(core);
      }),
    reloadFromDisk: () => run(() => reloadFromDisk(core)),
    keepMine: () => run(() => keepMine(core)),
    reviewKept: () => run(() => reviewKept(core)),
    closeKeptReview: () => run(async () => closeKeptReview(core)),
    hasUnsavedChanges: () => core.hasUnsavedChanges(),
    flushDraft: () => {
      if (!core.synced) core.writeDraftNow();
    },
    blockForLine: (line) => {
      if (!core.doc || !core.snapshot) return null;
      // Exact right after a load or save; after unsaved edits it is the nearest block.
      return Math.min(blockIndexForLine(core.snapshot, line), core.doc.childCount - 1);
    },
    caretForOffset: (offset) =>
      core.doc && core.snapshot ? caretForSourceOffset(core.doc, core.snapshot, offset) : null,
    onPathChange: (listener) => {
      core.onPathChange = listener;
    },
    dispose() {
      core.disposed = true;
      core.clearTimers();
      unsubscribe();
    },
  };
}
