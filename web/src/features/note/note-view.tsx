import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { DocumentTargetChooserHost } from '../../editor/attachments/document-target-chooser';
import { FormattingToolbar } from '../../editor/formatting/formatting-toolbar';
import type { MarkdownEditorHandle } from '../../editor/markdown-editor';
import { navigateTo, noteRoute } from '../../lib/app-navigation';
import { confirmDialog } from '../../lib/dialogs/dialog-requests';
import { i18n } from '../../i18n';
import { useShortcut } from '../../lib/shortcuts/use-shortcut';
import { noteTitleFromPath } from '../../lib/vault-paths';
import { useNoteAiActions } from '../ai-actions/use-note-ai-actions';
import { NoteInboxAction } from '../ai-inbox/inbox-entry-points';
import { ConflictScreen } from '../conflict/conflict-screen';
import { DailyNavRow } from '../daily/daily-nav-row';
import type { NoteSession } from '../note-session/note-session';
import type { SessionView } from '../note-session/note-session-types';
import { PropertyBar } from '../properties/property-bar';
import { NoteBanners } from './note-banners';
import { NoteEditorHost } from './note-editor-host';
import { noteScreenDropHandlers } from './note-file-drop';
import { NoteTitle } from './note-title';
import { retitleFirstHeading } from './retitle-first-heading';
import { SaveIndicator } from './save-indicator';
import { SourceModeEditor } from './source-mode-editor';
import { useCursorRequest } from './use-cursor-request';

interface NoteViewProps {
  session: NoteSession;
  view: SessionView;
  isNew: boolean;
  line: number | null;
  lineRequest: string;
  /** `&cursor=N`: UTF-16 offset in the file where the caret goes (template `{{cursor}}`). */
  cursor?: number | null;
}

/** Note screen layout (design.md screen 2): title and save state, banners, properties, body. */
export function NoteView(props: NoteViewProps) {
  const { session, view, isNew, line, lineRequest, cursor = null } = props;
  const titleId = useId();
  const editor = useRef<MarkdownEditorHandle | null>(null);
  const [handle, setHandle] = useState<MarkdownEditorHandle | null>(null);
  const tiptap: Editor | null = handle?.editor ?? null;
  const caretToCursor = useCursorRequest({
    session,
    view,
    handle,
    cursor,
    request: lineRequest,
    isNew,
  });
  const sourceField = useRef<HTMLTextAreaElement>(null);
  const inSource = view.source !== null;
  const conflict = view.conflict;
  // AI on a selection (toolbar menu, result panel, palette target).
  const ai = useNoteAiActions({
    session,
    handle,
    path: view.path,
    sourceMode: inSource,
    editable: !view.readOnly && conflict === null,
  });

  const toggleSource = useCallback(() => {
    if (session.getView().conflict) return;
    void session.toggleSourceMode();
  }, [session]);
  useShortcut({
    id: 'source-mode',
    keys: 'Alt+S',
    run: toggleSource,
    allowInInputs: true,
    labelKey: 'note.source.shortcut',
  });

  // A note created from a template (`&new=1`): its first naming also renames the heading the
  // template filled with the default name.
  const createdHere = useRef(isNew);
  const rename = async (title: string) => {
    const oldTitle = noteTitleFromPath(session.path());
    const result = await session.rename(title);
    const handle = editor.current;
    if (result.ok && createdHere.current && handle && session.getView().source === null) {
      createdHere.current = false;
      const newTitle = noteTitleFromPath(result.path);
      retitleFirstHeading(handle, oldTitle, newTitle);
    }
    return result;
  };

  // On a set-aside version, "Tải lại" lets it go for good: ask first.
  const reloadOrDiscardKept = async () => {
    const reviewing = session.getView().conflict?.keptId !== undefined;
    if (reviewing && !(await confirmDiscardKept())) return;
    await session.reloadFromDisk();
  };

  // Keep the caret with the mode the user switched to.
  const wasInSource = useRef(inSource);
  useEffect(() => {
    if (wasInSource.current === inSource) return;
    wasInSource.current = inSource;
    if (inSource) sourceField.current?.focus();
    else editor.current?.focus();
  }, [inSource]);

  return (
    <article
      className="note-screen"
      aria-labelledby={titleId}
      {...noteScreenDropHandlers(() => editor.current, inSource)}
    >
      <FormattingToolbar
        editor={tiptap}
        sourceMode={inSource}
        canToggleSource={conflict === null}
        onToggleSource={toggleSource}
        sourceField={sourceField}
        extraItem={ai.toolbarItem}
      />
      <DailyNavRow path={view.path} />
      <header className="note-screen__header">
        <NoteTitle
          id={titleId}
          title={noteTitleFromPath(view.path)}
          editable={conflict === null}
          autoSelect={isNew}
          // `new=1` is a one-time request: drop it so a reload does not select the title again.
          onAutoSelected={() => navigateTo(noteRoute(view.path), { replace: true })}
          onRename={rename}
          // `{ block: 0 }` moves the caret synchronously, while the title still has focus;
          // a deferred focus could land after the user already clicked into the body.
          onEnter={() => {
            if (!caretToCursor()) editor.current?.focus({ block: 0 });
          }}
        />
        <div className="note-screen__tools">
          <SaveIndicator status={view.status} onRetry={() => session.retry()} />
        </div>
      </header>
      {/* Under the title, not beside it: a long Inbox title keeps the whole row. */}
      <NoteInboxAction path={view.path} beforeOpen={() => session.flush()} />
      <NoteBanners
        view={view}
        onDiscardDraft={() => void session.discardDraft()}
        onReviewKept={() => void session.reviewKept()}
      />
      {conflict ? (
        <ConflictScreen
          conflict={conflict}
          busy={view.status === 'saving'}
          onReload={() => void reloadOrDiscardKept()}
          onKeepMine={() => void session.keepMine()}
          onClose={() => void session.closeKeptReview()}
        />
      ) : null}
      <div className="note-screen__body" hidden={conflict !== null}>
        {inSource ? null : (
          <PropertyBar
            frontmatterRaw={view.frontmatterRaw}
            disabled={view.readOnly}
            onPatch={(change) => session.patchFrontmatter(change)}
          />
        )}
        <div className="note-screen__editor" hidden={inSource}>
          <NoteEditorHost
            session={session}
            view={view}
            line={line}
            lineRequest={lineRequest}
            handleRef={editor}
            onHandle={setHandle}
          />
        </div>
        {view.source ? (
          <SourceModeEditor
            ref={sourceField}
            text={view.source.text}
            readOnly={view.readOnly}
            onChange={(text) => session.sourceChanged(text)}
          />
        ) : null}
      </div>
      {/* "Lưu vào" for documents dropped into the editor or source mode. */}
      <DocumentTargetChooserHost />
      {ai.panel}
    </article>
  );
}

function confirmDiscardKept(): Promise<boolean> {
  return confirmDialog({
    title: i18n.t('conflict.kept.discardTitle'),
    body: i18n.t('conflict.kept.discardBody'),
    confirmLabel: i18n.t('conflict.kept.discard'),
    cancelLabel: i18n.t('conflict.kept.keep'),
    danger: true,
  });
}
