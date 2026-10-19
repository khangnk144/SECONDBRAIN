import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { MarkdownEditor, type MarkdownEditorHandle } from '../../editor/markdown-editor';
import { noteTitleFromPath } from '../../lib/vault-paths';
import type { NoteSession } from '../note-session/note-session';
import type { SessionView } from '../note-session/note-session-types';

interface NoteEditorHostProps {
  session: NoteSession;
  view: SessionView;
  /** 1-based file line to show (`&line=N`), front matter counted. */
  line: number | null;
  /** Changes on every navigation, so the same line asked twice scrolls twice. */
  lineRequest: string;
  handleRef: MutableRefObject<MarkdownEditorHandle | null>;
}

/**
 * The editor of one note session: built once from the session's document; later documents the
 * session loads itself (outside edits, source mode, conflict resolution) go in through the handle.
 */
export function NoteEditorHost({
  session,
  view,
  line,
  lineRequest,
  handleRef,
}: NoteEditorHostProps) {
  const { t } = useTranslation();
  const [handle, setHandle] = useState<MarkdownEditorHandle | null>(null);
  const [initialDoc] = useState(view.doc);
  const shownVersion = useRef(view.docVersion);

  // Layout effect: the editor gets the session's new document in the same task the session
  // emitted it, before the next keystroke can be typed on the old one.
  useLayoutEffect(() => {
    if (!handle || !view.doc || view.docVersion === shownVersion.current) return;
    shownVersion.current = view.docVersion;
    handle.replaceDoc(view.doc, { keepSelection: view.keepSelection });
  }, [handle, view.doc, view.docVersion, view.keepSelection]);

  const showLine = view.source === null && view.conflict === null ? line : null;
  useEffect(() => {
    if (!handle || showLine === null) return;
    const block = session.blockForLine(showLine);
    if (block !== null) handle.focus({ block });
  }, [handle, session, showLine, lineRequest]);

  if (!initialDoc) return null;
  return (
    <MarkdownEditor
      initialDoc={initialDoc}
      notePath={view.path}
      editable={!view.readOnly && view.conflict === null && view.source === null}
      ariaLabel={t('note.editorLabel', { title: noteTitleFromPath(view.path) })}
      onDocChange={session.docChanged}
      onReady={(ready) => {
        handleRef.current = ready;
        setHandle(ready);
      }}
    />
  );
}
