/**
 * Leaving the open vault (SPEC F18.3, §4.13): before a switch every unsaved edit is saved (it
 * belongs to the vault open now) and its draft written; after a switch – here or in another
 * window – the page reloads, so tabs, drafts, panes and every per-vault state come back keyed by
 * the new vault's id. Nothing of this window reaches the server once another vault is open (the
 * API client sends the vault id; the server refuses a stale one).
 */
import type { VaultInfo } from '../../lib/api/settings-types';
import { switchVault } from '../../lib/api/vault-switch-api';
import type { VaultPath } from '../../lib/api/vault-types';
import { useTabsStore } from '../../lib/tabs-store';
import { useVaultStore } from '../../lib/vault-store';
import { pathKey } from '../../lib/vault-paths';
import {
  acquireNoteSession,
  noteHasUnsavedChanges,
  releaseNoteSession,
} from '../note-session/session-registry';
import { forgetVaultOpened, rememberVaultOpened } from './vault-opened-notice';

/** Time given to the IndexedDB draft writes before the page goes away. */
export const DRAFT_SETTLE_MS = 150;

let reloadPage: () => void = () => window.location.reload();
let reloading = false;

/** Tests replace the page reload. */
export function setPageReload(reload: (() => void) | null): void {
  reloadPage = reload ?? (() => window.location.reload());
  reloading = false;
}

export function isReloading(): boolean {
  return reloading;
}

function openNotePaths(): VaultPath[] {
  const seen = new Set<string>();
  const paths: VaultPath[] = [];
  for (const tab of useTabsStore.getState().tabs) {
    if (seen.has(pathKey(tab.path))) continue;
    seen.add(pathKey(tab.path));
    paths.push(tab.path);
  }
  return paths;
}

/**
 * Writes the draft of every open note with unsaved edits and, with `save`, saves it (resolves
 * when each save settled). Only notes that already have a session are touched.
 */
export async function flushOpenNotes(options: { save: boolean }): Promise<void> {
  const vaultId = useVaultStore.getState().vaultId;
  if (!vaultId) return;
  const pending = openNotePaths().filter((path) => noteHasUnsavedChanges(vaultId, path));
  await Promise.allSettled(
    pending.map(async (path) => {
      // The note's session exists (it has unsaved edits): this only borrows it.
      const session = acquireNoteSession(vaultId, path);
      try {
        session.flushDraft();
        if (options.save) await session.flush();
      } finally {
        releaseNoteSession(session);
      }
    }),
  );
  if (pending.length > 0) await new Promise((resolve) => setTimeout(resolve, DRAFT_SETTLE_MS));
}

/** Another vault is open now: keep the drafts, then reload into it (once). */
export async function reloadIntoOpenVault(): Promise<void> {
  if (reloading) return;
  reloading = true;
  await flushOpenNotes({ save: false });
  reloadPage();
}

/**
 * "Mở thư mục khác…": saves what she typed into the vault open now, asks the server to switch
 * and reloads into the new vault. Rejects with the server's refusal (the current vault stays).
 */
export async function openOtherVault(
  target: string,
  current: VaultInfo | null,
): Promise<'already-open' | 'reloading'> {
  await flushOpenNotes({ save: true });
  rememberVaultOpened({ kind: 'switched', path: target });
  let result: Awaited<ReturnType<typeof switchVault>>;
  try {
    result = await switchVault(target);
  } catch (error) {
    forgetVaultOpened();
    throw error;
  }
  if (current && result.vaultId === current.id && result.path === current.path) {
    forgetVaultOpened();
    return 'already-open';
  }
  // The server's spelling of the folder, when its answer came before the reload.
  rememberVaultOpened({ kind: 'switched', path: result.path });
  await reloadIntoOpenVault();
  return 'reloading';
}
