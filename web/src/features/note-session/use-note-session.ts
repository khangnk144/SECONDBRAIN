import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { VaultPath } from '../../lib/api/vault-types';
import { pathKey, samePath } from '../../lib/vault-paths';
import { useVaultStore } from '../../lib/vault-store';
import type { NoteSession } from './note-session';
import type { SessionView } from './note-session-types';
import { acquireNoteSession, releaseNoteSession } from './session-registry';

const noSubscription = () => () => undefined;
const noView = () => null;

interface Held {
  session: NoteSession;
  /** The route path the session was acquired for. */
  path: VaultPath;
}

/**
 * The session of the note at `path` in the open vault, held while the component is mounted. A
 * rename keeps the same session (it moved with the note), so typed text and undo survive it.
 * `moved` is true when the note was renamed but the route still names its old path.
 */
export function useNoteSession(path: VaultPath | null): {
  session: NoteSession | null;
  view: SessionView | null;
  moved: boolean;
} {
  const vaultId = useVaultStore((state) => state.vaultId);
  const [held, setHeld] = useState<Held | null>(null);
  const latestPath = useRef(path);
  latestPath.current = path;
  const key = path !== null && vaultId !== null ? `${vaultId}|${pathKey(path)}` : null;

  useEffect(() => {
    const target = latestPath.current;
    if (key === null || target === null || vaultId === null) {
      setHeld(null);
      return;
    }
    const session = acquireNoteSession(vaultId, target);
    setHeld({ session, path: target });
    return () => releaseNoteSession(session);
  }, [key, vaultId]);

  // A session held for another route is stale (another tab is opening) unless it moved here.
  const current =
    held && path !== null && (samePath(held.path, path) || samePath(held.session.path(), path))
      ? held.session
      : null;
  const view = useSyncExternalStore(
    current ? current.subscribe : noSubscription,
    current ? current.getView : noView,
  );
  const moved = view !== null && path !== null && !samePath(view.path, path);
  return { session: current, view, moved };
}
