/**
 * Vault files shown inside the app (embedded images): `<img src>` cannot carry the session token,
 * so the file is fetched with the token (`GET /api/files`) and shown through an object URL. One
 * entry per vault file, shared by every view that shows it; a changed or re-created file (WS
 * `note:changed` / `note:created` with a new revision) is fetched again and every watcher gets the
 * new URL; an entry nobody watches is dropped (URL revoked) after a short idle time, so scrolling
 * or retyping around an image does not fetch it again.
 */
import { apiAuthHeaders } from './api';
import { withQuery } from './api/query-string';
import type { VaultPath } from './api/vault-types';
import { pathKey } from './vault-paths';
import { useVaultStore } from './vault-store';
import { subscribeServerEvent } from './ws/server-event-bus';

export type VaultFileBlob =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  /** `GET /api/files` answered 404: the file is not (or no longer) in the vault. */
  | { status: 'missing' }
  | { status: 'error' };

export type VaultFileBlobListener = (blob: VaultFileBlob) => void;

/** How long an unwatched entry keeps its object URL. */
export const VAULT_FILE_BLOB_IDLE_MS = 30_000;

interface Entry {
  key: string;
  path: VaultPath;
  blob: VaultFileBlob;
  /** Last revision an event reported (null: none seen yet). */
  revision: string | null;
  listeners: Set<VaultFileBlobListener>;
  /** Bumped per fetch, so a slow older answer never replaces a newer one. */
  seq: number;
  controller: AbortController | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, Entry>();
let unsubscribeEvents: (() => void) | null = null;

/** `/api/files?path=…` (`download` forces a download, also for images). */
export function vaultFileUrl(path: VaultPath, options: { download?: boolean } = {}): string {
  return withQuery('/api/files', { path, download: options.download ? 1 : undefined });
}

/**
 * Watches the object URL of `path`: the listener is called at once with the current state and
 * again whenever it changes. Returns the unsubscribe function.
 */
export function watchVaultFileBlob(path: VaultPath, listener: VaultFileBlobListener): () => void {
  ensureEventSubscription();
  const key = entryKey(path);
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      key,
      path,
      blob: { status: 'loading' },
      revision: null,
      listeners: new Set(),
      seq: 0,
      controller: null,
      idleTimer: null,
    };
    entries.set(key, entry);
    void load(entry);
  }
  const current = entry;
  if (current.idleTimer !== null) {
    clearTimeout(current.idleTimer);
    current.idleTimer = null;
  }
  current.listeners.add(listener);
  listener(current.blob);
  return () => {
    if (!current.listeners.delete(listener) || current.listeners.size > 0) return;
    current.idleTimer = setTimeout(() => drop(current), VAULT_FILE_BLOB_IDLE_MS);
  };
}

/** Test helper: revokes every URL and forgets entries and the event subscription. */
export function resetVaultFileBlobs(): void {
  for (const entry of [...entries.values()]) drop(entry);
  unsubscribeEvents?.();
  unsubscribeEvents = null;
}

function entryKey(path: VaultPath): string {
  return `${useVaultStore.getState().vaultId ?? ''}|${pathKey(path)}`;
}

async function load(entry: Entry): Promise<void> {
  const seq = ++entry.seq;
  entry.controller?.abort();
  const controller = new AbortController();
  entry.controller = controller;
  const headers = apiAuthHeaders();
  let next: VaultFileBlob;
  try {
    const response = await fetch(vaultFileUrl(entry.path), {
      headers,
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (response.status === 404) next = { status: 'missing' };
    else if (!response.ok) next = { status: 'error' };
    else {
      const blob = await response.blob();
      if (seq !== entry.seq || entries.get(entry.key) !== entry) return;
      next = { status: 'ready', url: URL.createObjectURL(blob) };
    }
  } catch {
    next = { status: 'error' };
  }
  if (seq !== entry.seq || entries.get(entry.key) !== entry) {
    if (next.status === 'ready') URL.revokeObjectURL(next.url);
    return;
  }
  entry.controller = null;
  setBlob(entry, next);
}

function setBlob(entry: Entry, blob: VaultFileBlob): void {
  const previous = entry.blob;
  entry.blob = blob;
  if (previous.status === 'ready' && (blob.status !== 'ready' || blob.url !== previous.url)) {
    URL.revokeObjectURL(previous.url);
  }
  for (const listener of [...entry.listeners]) listener(blob);
}

function drop(entry: Entry): void {
  if (entry.idleTimer !== null) clearTimeout(entry.idleTimer);
  entry.controller?.abort();
  entry.seq += 1;
  if (entries.get(entry.key) === entry) entries.delete(entry.key);
  if (entry.blob.status === 'ready') URL.revokeObjectURL(entry.blob.url);
  entry.blob = { status: 'loading' };
}

/** A file that changed or came back: watched entries fetch again, idle ones are forgotten. */
function refresh(path: VaultPath, revision: string | null): void {
  const entry = entries.get(entryKey(path));
  if (!entry) return;
  if (revision !== null && revision === entry.revision && entry.blob.status === 'ready') return;
  entry.revision = revision;
  if (entry.listeners.size === 0) drop(entry);
  else void load(entry);
}

function markMissing(path: VaultPath): void {
  const entry = entries.get(entryKey(path));
  if (!entry) return;
  entry.seq += 1;
  entry.controller?.abort();
  entry.revision = null;
  if (entry.listeners.size === 0) drop(entry);
  else setBlob(entry, { status: 'missing' });
}

function ensureEventSubscription(): void {
  if (unsubscribeEvents) return;
  const unsubscribers = [
    subscribeServerEvent('note:changed', (event) => refresh(event.path, event.revision)),
    subscribeServerEvent('note:created', (event) => refresh(event.path, event.revision)),
    subscribeServerEvent('note:deleted', (event) => markMissing(event.path)),
    subscribeServerEvent('note:renamed', (event) => {
      markMissing(event.oldPath);
      refresh(event.path, event.revision);
    }),
    subscribeServerEvent('resync', () => {
      for (const entry of [...entries.values()]) refresh(entry.path, null);
    }),
  ];
  unsubscribeEvents = () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}
