/**
 * The mutable state of one note session and the helpers every operation shares: the text of
 * record, documents, drafts and timers. Operations (save, conflicts, outside changes) live in
 * their own modules and act on this core; `note-session.ts` wires them together.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  loadMarkdown,
  saveMarkdownWithSnapshot,
  type MarkdownSnapshot,
} from '../../editor/markdown/markdown-document';
import type { ContentClass, VaultPath } from '../../lib/api/vault-types';
import type {
  ConflictVersions,
  RecordText,
  SessionDeps,
  SessionView,
  SourceState,
} from './note-session-types';
import type { SaveErrorKind } from './save-errors';
import { createSerialQueue } from './serial-queue';
import { DraftSync } from './session-draft-sync';
import { SessionTimers, type TimerName } from './session-timers';
import { deriveView } from './session-view';

export const DRAFT_DELAY_MS = 300;
export const AUTOSAVE_DELAY_MS = 500;

export class SessionCore {
  readonly queue = createSerialQueue();
  path: VaultPath;
  phase: 'loading' | 'ready' | 'not-found' | 'failed' = 'loading';
  readOnly = false;
  noteClass: ContentClass | null = null;
  baseText: string | null = null;
  baseRevision: string | null = null;
  doc: ProseMirrorNode | null = null;
  snapshot: MarkdownSnapshot | null = null;
  frontmatterRaw: string | null = null;
  docVersion = 0;
  keepSelection = false;
  /** Bumped on every edit; operations compare it to know whether edits came in meanwhile. */
  changeSeq = 0;
  /** The text of record equals `baseText` (as of the last check). */
  synced = true;
  /** `changeSeq` covered by the last draft written. */
  draftSeq = -1;
  inFlight = 0;
  lastSaved = false;
  error: SaveErrorKind | null = null;
  retryAttempt = 0;
  conflict: ConflictVersions | null = null;
  keptCount = 0;
  /** The disk text a restored draft replaced ("Bỏ bản nháp" goes back to it). */
  restored: { text: string } | null = null;
  source: SourceState | null = null;
  /** The last save wrote canonical text the document does not match: reload it when quiet. */
  reloadAfterSave = false;
  disposed = false;
  /** Set by the session: queue a save of the text of record. */
  requestSave: () => void = () => undefined;
  /** Set by the registry: the note moved to another path. */
  onPathChange: (oldPath: VaultPath, newPath: VaultPath) => void = () => undefined;

  private listeners = new Set<() => void>();
  private cachedView: SessionView | null = null;
  private recordCache: {
    doc: ProseMirrorNode;
    snapshot: MarkdownSnapshot;
    value: RecordText;
  } | null = null;
  private timers = new SessionTimers();

  readonly drafts: DraftSync;

  constructor(
    readonly deps: SessionDeps,
    readonly vaultId: string,
    path: VaultPath,
  ) {
    this.path = path;
    this.drafts = new DraftSync(deps, vaultId);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  view(): SessionView {
    this.cachedView ??= deriveView(this);
    return this.cachedView;
  }

  emit(): void {
    this.cachedView = null;
    for (const listener of [...this.listeners]) listener();
  }

  /** The text that would be written now (SPEC: `saveMarkdown(doc, snapshot)`, or source text). */
  record(): RecordText {
    if (this.source) return { text: this.source.fileText, snapshot: null, exact: true };
    const { doc, snapshot } = this;
    if (!doc || !snapshot) return { text: this.baseText ?? '', snapshot: null, exact: true };
    const cache = this.recordCache;
    if (cache && cache.doc === doc && cache.snapshot === snapshot) return cache.value;
    const result = saveMarkdownWithSnapshot(doc, snapshot);
    const value = { text: result.text, snapshot: result.snapshot, exact: result.exact };
    this.recordCache = { doc, snapshot, value };
    return value;
  }

  hasUnsavedChanges(): boolean {
    if (this.conflict) return true;
    if (this.synced || this.phase !== 'ready') return false;
    return this.record().text !== this.baseText;
  }

  setBase(text: string, revision: string): void {
    this.baseText = text;
    this.baseRevision = revision;
  }

  /** Replaces the document (and its snapshot) by a fresh parse of `text`. */
  loadDoc(text: string, options: { keepSelection?: boolean } = {}): void {
    const loaded = loadMarkdown(text, this.deps.schema);
    this.doc = loaded.doc;
    this.snapshot = loaded.snapshot;
    this.frontmatterRaw = loaded.frontmatter?.raw ?? null;
    this.docVersion += 1;
    this.keepSelection = options.keepSelection === true;
    this.reloadAfterSave = false;
  }

  /** Re-checks `synced` against the current base (after the base moved). */
  resync(): void {
    this.synced = this.record().text === this.baseText;
  }

  setPath(path: VaultPath): void {
    if (path === this.path) return;
    const old = this.path;
    this.path = path;
    this.onPathChange(old, path);
    this.drafts.move(old, path);
    this.emit();
  }

  markChanged(): void {
    this.changeSeq += 1;
    this.synced = false;
    this.restartAutosave();
    if (!this.timers.pending('draftTimer') && !this.disposed) {
      // Throttled, not debounced: at most 300 ms of typing is ever only in memory.
      this.timers.start('draftTimer', DRAFT_DELAY_MS, () => this.writeDraftNow());
    }
    this.emit();
  }

  /** Stores the text of record as the draft now (or drops the draft when there is nothing new). */
  writeDraftNow(): void {
    this.clearTimer('draftTimer');
    if (this.phase !== 'ready' || this.readOnly || this.conflict || this.baseRevision === null) {
      return;
    }
    const seq = this.changeSeq;
    const text = this.record().text;
    if (text === this.baseText) {
      if (this.inFlight === 0) this.synced = true;
      this.removeDraft();
      this.emit();
      return;
    }
    this.storeDraft(text, this.baseRevision, seq);
  }

  storeDraft(text: string, baseRevision: string, seq = this.changeSeq): void {
    void this.drafts.store(this.path, baseRevision, text).then((stored) => {
      if (!stored || seq <= this.draftSeq) return;
      this.draftSeq = seq;
      this.emit();
    });
  }

  removeDraft(): void {
    this.drafts.remove(this.path);
  }

  restartAutosave(delayMs = AUTOSAVE_DELAY_MS): void {
    if (this.disposed) return this.timers.clear('autosaveTimer');
    this.timers.start('autosaveTimer', delayMs, () => this.requestSave());
  }

  scheduleRetry(delayMs: number): void {
    if (this.disposed) return this.timers.clear('retryTimer');
    this.timers.start('retryTimer', delayMs, () => this.requestSave());
  }

  clearTimer(name: TimerName): void {
    this.timers.clear(name);
  }

  clearTimers(): void {
    this.timers.clearAll();
  }
}
