/**
 * Versions set aside instead of being discarded ("Tải lại" on the conflict screen keeps "mine"
 * here first, SPEC §4.10). The note screen lists them so they can be restored or let go.
 */
import type { VaultPath } from '../../lib/api/vault-types';
import { pathKey } from '../../lib/vault-paths';
import {
  KEPT_BY_NOTE_INDEX,
  KEPT_STORE,
  openDraftDatabase,
  requestResult,
  transactionDone,
} from './draft-database';

export interface KeptVersion {
  /** Set by the database. */
  id?: number;
  vaultId: string;
  path: VaultPath;
  baseRevision: string | null;
  text: string;
  reason: 'conflict-reload';
  ts: number;
}

function warn(action: string, error: unknown): void {
  console.warn(`draft storage: ${action} failed`, error);
}

export async function keepVersion(version: KeptVersion): Promise<boolean> {
  try {
    const db = await openDraftDatabase();
    const transaction = db.transaction(KEPT_STORE, 'readwrite');
    const { id: _id, ...row } = version;
    transaction.objectStore(KEPT_STORE).add({ ...row, key: pathKey(version.path) });
    await transactionDone(transaction);
    return true;
  } catch (error) {
    warn('keep', error);
    return false;
  }
}

/** The versions set aside for one note, oldest first. */
export async function listKeptVersions(vaultId: string, path: VaultPath): Promise<KeptVersion[]> {
  try {
    const db = await openDraftDatabase();
    const index = db
      .transaction(KEPT_STORE, 'readonly')
      .objectStore(KEPT_STORE)
      .index(KEPT_BY_NOTE_INDEX);
    const rows = (await requestResult(index.getAll([vaultId, pathKey(path)]))) as KeptVersion[];
    return rows.map(({ id, vaultId: v, path: p, baseRevision, text, reason, ts }) => ({
      id,
      vaultId: v,
      path: p,
      baseRevision,
      text,
      reason,
      ts,
    }));
  } catch (error) {
    warn('list kept versions', error);
    return [];
  }
}

export async function removeKeptVersion(id: number): Promise<boolean> {
  try {
    const db = await openDraftDatabase();
    const transaction = db.transaction(KEPT_STORE, 'readwrite');
    transaction.objectStore(KEPT_STORE).delete(id);
    await transactionDone(transaction);
    return true;
  } catch (error) {
    warn('remove kept version', error);
    return false;
  }
}
