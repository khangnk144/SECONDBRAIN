/**
 * The browser database for unsaved note text (SPEC §5): drafts, one per note and browser window,
 * and the versions the conflict screen sets aside when the user reloads the disk version.
 * Opened lazily, once.
 */
const DB_NAME = 'second-brain-drafts';
/** 2: drafts are keyed per window (vault id, note path key, window id). */
const DB_VERSION = 2;
export const DRAFTS_STORE = 'drafts';
export const DRAFTS_BY_NOTE_INDEX = 'by-note';
export const KEPT_STORE = 'kept';
export const KEPT_BY_NOTE_INDEX = 'by-note';
/** Window id given to drafts written before drafts were kept per window. */
export const EARLIER_WINDOW_ID = 'earlier';

let opening: Promise<IDBDatabase> | null = null;

function createDraftsStore(db: IDBDatabase): IDBObjectStore {
  const store = db.createObjectStore(DRAFTS_STORE, { keyPath: ['vaultId', 'key', 'windowId'] });
  store.createIndex(DRAFTS_BY_NOTE_INDEX, ['vaultId', 'key']);
  return store;
}

function upgrade(db: IDBDatabase, transaction: IDBTransaction | null, oldVersion: number): void {
  if (!db.objectStoreNames.contains(DRAFTS_STORE)) {
    createDraftsStore(db);
  } else if (oldVersion < 2 && transaction) {
    // Version 1 keyed drafts per note only: carry them over, never drop typed text.
    const rows = transaction.objectStore(DRAFTS_STORE).getAll();
    rows.onsuccess = () => {
      db.deleteObjectStore(DRAFTS_STORE);
      const store = createDraftsStore(db);
      for (const row of rows.result as Record<string, unknown>[]) {
        store.put({ ...row, windowId: EARLIER_WINDOW_ID });
      }
    };
  }
  if (!db.objectStoreNames.contains(KEPT_STORE)) {
    const kept = db.createObjectStore(KEPT_STORE, { keyPath: 'id', autoIncrement: true });
    kept.createIndex(KEPT_BY_NOTE_INDEX, ['vaultId', 'key']);
  }
}

export function openDraftDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    const factory = globalThis.indexedDB as IDBFactory | undefined;
    if (!factory) {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) =>
      upgrade(request.result, request.transaction, event.oldVersion);
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading the database: let it, and reopen on the next access.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
  opening = attempt;
  attempt.catch(() => {
    if (opening === attempt) opening = null;
  });
  return attempt;
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB failed'));
  });
}

/** Test helper: closes the connection so the next access opens a fresh factory's database. */
export async function closeDraftDatabase(): Promise<void> {
  const current = opening;
  opening = null;
  if (!current) return;
  try {
    (await current).close();
  } catch {
    // Never opened: nothing to close.
  }
}
