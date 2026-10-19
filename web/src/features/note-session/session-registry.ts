/**
 * One session per open note (vault id + note path), shared by everything that shows the note.
 * When the last user lets go, pending edits are saved before the session is dropped; a session
 * follows its note through renames. Leaving the page writes every draft at once.
 */
import { editorSchema } from '../../editor/schema/editor-schema';
import { getNote, patchNoteFrontmatter, postNote, putNote } from '../../lib/api/notes-api';
import type { VaultPath } from '../../lib/api/vault-types';
import { renameNote } from '../../lib/note-operations';
import { setKeepTabWhenDeleted } from '../../lib/tabs-sync';
import { useVaultStore } from '../../lib/vault-store';
import { pathKey } from '../../lib/vault-paths';
import { indexedDbDrafts, PAGE_WINDOW_ID } from '../drafts/draft-store';
import { createNoteSession, type NoteSession } from './note-session';
import type { SessionDeps } from './note-session-types';
import { showSessionNotice } from './session-notices';

interface Entry {
  session: NoteSession;
  refs: number;
}

const sessions = new Map<string, Entry>();
let removePageListeners: (() => void) | null = null;

export function defaultSessionDeps(): SessionDeps {
  return {
    api: { getNote, putNote, postNote, patchNoteFrontmatter },
    drafts: indexedDbDrafts,
    renameNote,
    notify: showSessionNotice,
    schema: editorSchema,
    now: () => Date.now(),
    windowId: PAGE_WINDOW_ID,
  };
}

const keyOf = (vaultId: string, path: VaultPath) => `${vaultId}\u0000${pathKey(path)}`;

// A note deleted elsewhere keeps its tab while it has unsaved text: the conflict screen then
// offers "Giữ bản của tôi", which re-creates the file.
setKeepTabWhenDeleted((path) => {
  const vaultId = useVaultStore.getState().vaultId;
  return vaultId !== null && noteHasUnsavedChanges(vaultId, path);
});

function flushAll(): void {
  for (const { session } of sessions.values()) {
    session.flushDraft();
    void session.flush();
  }
}

function installPageListeners(): void {
  if (removePageListeners || typeof window === 'undefined') return;
  const onHidden = () => {
    if (document.visibilityState === 'hidden') flushAll();
  };
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', onHidden);
  removePageListeners = () => {
    window.removeEventListener('pagehide', flushAll);
    document.removeEventListener('visibilitychange', onHidden);
  };
}

export function acquireNoteSession(
  vaultId: string,
  path: VaultPath,
  deps: SessionDeps = defaultSessionDeps(),
): NoteSession {
  installPageListeners();
  const existing = sessions.get(keyOf(vaultId, path));
  if (existing) {
    existing.refs += 1;
    return existing.session;
  }
  const session = createNoteSession(deps, vaultId, path);
  const entry: Entry = { session, refs: 1 };
  sessions.set(keyOf(vaultId, path), entry);
  session.onPathChange((oldPath, newPath) => {
    if (sessions.get(keyOf(vaultId, oldPath)) === entry) sessions.delete(keyOf(vaultId, oldPath));
    sessions.set(keyOf(vaultId, newPath), entry);
  });
  void session.open();
  return session;
}

/**
 * Lets go of a session. The check waits a microtask, so a release immediately followed by an
 * acquire (route change to the renamed path, StrictMode effects) keeps the same session.
 */
export function releaseNoteSession(session: NoteSession): void {
  const key = keyOf(session.vaultId, session.path());
  const entry = sessions.get(key);
  if (!entry || entry.session !== session) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  queueMicrotask(() => {
    if (entry.refs > 0) return;
    session.flushDraft();
    void session.flush().finally(() => {
      if (entry.refs > 0) return;
      session.dispose();
      const current = keyOf(session.vaultId, session.path());
      if (sessions.get(current) === entry) sessions.delete(current);
    });
  });
}

/**
 * True while the open note at `path` holds text the disk does not have (unsaved edits or an open
 * conflict). Lets other parts of the app (tabs closing on outside deletion) keep it on screen.
 */
export function noteHasUnsavedChanges(vaultId: string, path: VaultPath): boolean {
  return sessions.get(keyOf(vaultId, path))?.session.hasUnsavedChanges() ?? false;
}

/** Test helper: drops every session without saving. */
export function resetNoteSessions(): void {
  for (const { session } of sessions.values()) session.dispose();
  sessions.clear();
  removePageListeners?.();
  removePageListeners = null;
}

export function openSessionCount(): number {
  return sessions.size;
}
