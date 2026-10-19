/**
 * Drafts of unsaved note text in IndexedDB (SPEC §4.13, §5), one per vault, note and browser
 * window: a window only ever deletes the drafts it wrote (or took over on open), so a clean second
 * window never wipes the only copy of what the first one typed. Storage failures (private
 * windows, quota) never break editing: every call resolves, and the ones whose success matters
 * report it.
 */
import type { VaultPath } from '../../lib/api/vault-types';
import { pathKey } from '../../lib/vault-paths';
import {
  DRAFTS_BY_NOTE_INDEX,
  DRAFTS_STORE,
  openDraftDatabase,
  requestResult,
  transactionDone,
} from './draft-database';
import {
  keepVersion,
  listKeptVersions,
  removeKeptVersion,
  type KeptVersion,
} from './kept-versions';

export type { KeptVersion } from './kept-versions';
export { listKeptVersions } from './kept-versions';

export interface NoteDraft {
  vaultId: string;
  path: VaultPath;
  /** Revision of the disk text this draft was typed on top of. */
  baseRevision: string;
  /** The whole file text of record (front matter, BOM and line endings included). */
  text: string;
  ts: number;
  /** The browser window (page load) that typed it. */
  windowId: string;
}

interface StoredDraft extends NoteDraft {
  key: string;
}

export interface DraftStorage {
  /** The newest draft of the note, from any window. */
  read(vaultId: string, path: VaultPath): Promise<NoteDraft | null>;
  write(draft: NoteDraft): Promise<boolean>;
  remove(vaultId: string, path: VaultPath, windowId: string): Promise<void>;
  /** The note was renamed: that window's draft follows it. */
  move(vaultId: string, from: VaultPath, to: VaultPath, windowId: string): Promise<void>;
  keep(version: KeptVersion): Promise<boolean>;
  listKept(vaultId: string, path: VaultPath): Promise<KeptVersion[]>;
  removeKept(id: number): Promise<boolean>;
}

function newWindowId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

/** This page's window id. */
export const PAGE_WINDOW_ID = newWindowId();

function warn(action: string, error: unknown): void {
  console.warn(`draft storage: ${action} failed`, error);
}

async function read(vaultId: string, path: VaultPath): Promise<NoteDraft | null> {
  try {
    const db = await openDraftDatabase();
    const index = db
      .transaction(DRAFTS_STORE, 'readonly')
      .objectStore(DRAFTS_STORE)
      .index(DRAFTS_BY_NOTE_INDEX);
    const rows = (await requestResult(index.getAll([vaultId, pathKey(path)]))) as StoredDraft[];
    const newest = rows.reduce<StoredDraft | null>((a, b) => (a && a.ts >= b.ts ? a : b), null);
    if (!newest) return null;
    const { key: _key, ...draft } = newest;
    return draft;
  } catch (error) {
    warn('read', error);
    return null;
  }
}

async function write(draft: NoteDraft): Promise<boolean> {
  try {
    const db = await openDraftDatabase();
    const transaction = db.transaction(DRAFTS_STORE, 'readwrite');
    const stored: StoredDraft = { ...draft, key: pathKey(draft.path) };
    transaction.objectStore(DRAFTS_STORE).put(stored);
    await transactionDone(transaction);
    return true;
  } catch (error) {
    warn('write', error);
    return false;
  }
}

async function remove(vaultId: string, path: VaultPath, windowId: string): Promise<void> {
  try {
    const db = await openDraftDatabase();
    const transaction = db.transaction(DRAFTS_STORE, 'readwrite');
    transaction.objectStore(DRAFTS_STORE).delete([vaultId, pathKey(path), windowId]);
    await transactionDone(transaction);
  } catch (error) {
    warn('remove', error);
  }
}

async function move(
  vaultId: string,
  from: VaultPath,
  to: VaultPath,
  windowId: string,
): Promise<void> {
  if (pathKey(from) === pathKey(to)) return;
  try {
    const db = await openDraftDatabase();
    const transaction = db.transaction(DRAFTS_STORE, 'readwrite');
    const store = transaction.objectStore(DRAFTS_STORE);
    const found = (await requestResult(store.get([vaultId, pathKey(from), windowId]))) as
      StoredDraft | undefined;
    if (found) {
      store.put({ ...found, path: to, key: pathKey(to) });
      store.delete([vaultId, pathKey(from), windowId]);
    }
    await transactionDone(transaction);
  } catch (error) {
    warn('move', error);
  }
}

export const indexedDbDrafts: DraftStorage = {
  read,
  write,
  remove,
  move,
  keep: keepVersion,
  listKept: listKeptVersions,
  removeKept: removeKeptVersion,
};
