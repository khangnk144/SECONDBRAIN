import { useEffect, useRef } from 'react';
import type { MarkdownEditorHandle } from '../../editor/markdown-editor';
import { currentRoute, navigateTo, NOTE_ROUTE, noteRoute } from '../../lib/app-navigation';
import type { VaultPath } from '../../lib/api/vault-types';
import { samePath } from '../../lib/vault-paths';
import type { NoteSession } from '../note-session/note-session';
import type { SessionView } from '../note-session/note-session-types';

interface CursorRequestOptions {
  session: NoteSession;
  view: SessionView;
  handle: MarkdownEditorHandle | null;
  /** UTF-16 offset in the file from `&cursor=N` (a template's `{{cursor}}`), or null. */
  cursor: number | null;
  /** Changes on every navigation, so a repeated request is honoured again. */
  request: string;
  /** A new note: its title takes the focus first; Enter there moves on to the cursor. */
  isNew: boolean;
}

/**
 * Whether the router still shows (or is about to show) note `path`. Another note opened a moment
 * ago is already in the router's live location, before this screen re-renders for it.
 */
function routeShowsNote(path: VaultPath): boolean {
  const route = currentRoute();
  if (route === null) return true; // no live router to ask (tests render one screen)
  if (route.pathname !== NOTE_ROUTE) return false;
  const shown = new URLSearchParams(route.search).get('path');
  return shown !== null && samePath(shown, path);
}

/**
 * Puts the caret where the template's `{{cursor}}` was (F14.2). A note opened with `&cursor=N`
 * gets the caret there as soon as it is shown and the request leaves the address; a new note
 * keeps it for the moment its title is confirmed with Enter. Returns the function the title's
 * Enter calls: true when it placed the caret.
 */
export function useCursorRequest(options: CursorRequestOptions): () => boolean {
  const { session, view, handle, cursor, request, isNew } = options;
  const pending = useRef<number | null>(null);
  const waitForTitle = useRef(isNew);

  useEffect(() => {
    if (cursor !== null) pending.current = cursor;
  }, [cursor, request]);

  const place = (): boolean => {
    const offset = pending.current;
    if (offset === null || !handle) return false;
    const caret = session.caretForOffset(offset);
    if (!caret) return false;
    pending.current = null;
    handle.focus({ caret });
    return true;
  };

  const shown = view.source === null && view.conflict === null;
  useEffect(() => {
    if (!shown || waitForTitle.current || pending.current === null) return;
    // The user already moved on to another note or screen: neither the caret nor the address of
    // this note may pull them back (a replace would undo their navigation).
    if (!routeShowsNote(view.path)) return;
    if (place() && cursor !== null) navigateTo(noteRoute(view.path), { replace: true });
    // `place` reads refs and the current handle; it runs again when one of these changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, shown, cursor, request]);

  return () => {
    waitForTitle.current = false;
    return shown && place();
  };
}
