/** Events pushed on `/ws`, mirrored from `server/src/ws/server-events.ts`. */
import type { PendingJournalEntry } from '../api/journal-types';
import type { VaultPath } from '../api/vault-types';

export interface IndexProgress {
  phase: 'scan' | 'index' | 'swap' | 'done';
  done: number;
  total: number;
}

export type ServerEvent =
  | { type: 'hello'; version: string }
  | { type: 'note:changed' | 'note:created'; path: VaultPath; revision: string }
  | { type: 'note:deleted'; path: VaultPath }
  | { type: 'note:renamed'; path: VaultPath; oldPath: VaultPath; revision: string }
  | { type: 'folder:changed'; path: VaultPath }
  | ({ type: 'index:progress' } & IndexProgress)
  | { type: 'journal:pending'; entries: PendingJournalEntry[] };

/**
 * `resync` is synthetic: emitted by the client after a reconnect, because events may have been
 * missed while the socket was down; every store that mirrors server data refetches on it.
 */
export type ClientEvent = ServerEvent | { type: 'resync' };

export type ClientEventType = ClientEvent['type'];

/** The event shape for one type (a member may cover several types, e.g. changed/created). */
type EventFor<E, T> = E extends { type: infer K } ? (T extends K ? E : never) : never;
export type ClientEventOf<T extends ClientEventType> = EventFor<ClientEvent, T>;
