/** Events pushed on `/ws`, mirrored from `server/src/ws/server-events.ts`. */
import type { PendingJournalEntry } from '../api/journal-types';
import type { ReminderEntry } from '../api/reminders-types';
import type { VaultPath } from '../api/vault-types';
import type { UiPrefs } from '../ui-prefs';

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
  | { type: 'journal:pending'; entries: PendingJournalEntry[] }
  /** A reminder fired (on time or caught up); carries the final outcome of the server toast. */
  | { type: 'reminder'; reminder: ReminderEntry }
  /** Another vault is open now: windows keep their drafts and reload. */
  | { type: 'vault:switched'; vaultId: string }
  /** The UI settings changed (in any window): apply them here at once. */
  | { type: 'settings:changed'; ui: UiPrefs }
  /** M6: an MCP ingest finished; `outputs` in the order the AI wrote them (graph effect). */
  | { type: 'ai:touched'; source: VaultPath; outputs: VaultPath[] }
  /** M6: AI settings, budget or embedding progress changed; refetch `GET /api/ai/status`. */
  | { type: 'ai:status'; embeddings: { state: string; done: number; total: number } }
  /** M6: the text of a source file was read (Documents view, search). */
  | { type: 'source:extracted'; path: VaultPath; quality: 'ok' | 'low' | 'none' };

/**
 * `resync` is synthetic: emitted by the client after a reconnect, because events may have been
 * missed while the socket was down; every store that mirrors server data refetches on it.
 */
export type ClientEvent = ServerEvent | { type: 'resync' };

export type ClientEventType = ClientEvent['type'];

/** The event shape for one type (a member may cover several types, e.g. changed/created). */
type EventFor<E, T> = E extends { type: infer K } ? (T extends K ? E : never) : never;
export type ClientEventOf<T extends ClientEventType> = EventFor<ClientEvent, T>;
