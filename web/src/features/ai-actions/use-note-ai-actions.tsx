/**
 * Everything the note screen mounts for AI on a selection (SPEC F33 editor actions): the "AI"
 * toolbar menu, the result panel, and the target the palette commands act on. Nothing shows
 * before the AI status is known, and nothing at all when the server has no AI.
 */
import { useEditorState } from '@tiptap/react';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { MarkdownEditorHandle } from '../../editor/editor-handle';
import type { ToolbarExtraItem } from '../../editor/formatting/toolbar-extra-item';
import { hasMeaningfulSelection } from '../../editor/selection-markdown';
import { useAiStatusStore } from '../../lib/ai-status-store';
import type { NoteSession } from '../note-session/note-session';
import { registerAiActionTarget } from './ai-action-target';
import { aiBlocker, type AiBlocker } from './ai-readiness';
import { focusEditorNow } from './apply-ai-result';
import { AiResultPanel } from './ai-result-panel';
import { AI_MENU_ITEM_ID, AI_MENU_WIDTH_REM, AiToolbarButton } from './ai-toolbar-button';
import { useAiActionPanel } from './use-ai-action-panel';

interface NoteAiInputs {
  session: NoteSession;
  handle: MarkdownEditorHandle | null;
  /** The note shown (follows renames). */
  path: string;
  sourceMode: boolean;
  editable: boolean;
}

export interface NoteAiActions {
  /** The "AI" menu for the formatting toolbar; undefined while AI is unknown or absent. */
  toolbarItem: ToolbarExtraItem | undefined;
  /** The result panel (null while closed). */
  panel: ReactNode;
}

export function useNoteAiActions(inputs: NoteAiInputs): NoteAiActions {
  const { session, handle, path, sourceMode, editable } = inputs;
  const status = useAiStatusStore((store) => store.status);
  const editor = handle?.editor ?? null;
  const selected = useEditorState({
    editor,
    selector: ({ editor: current }) => (current ? hasMeaningfulSelection(current.state) : false),
  });
  const controller = useAiActionPanel({
    handle,
    path: () => session.path(),
    sourceMode,
    editable,
  });

  // Source mode or a conflict takes the rich editor away: a result could no longer go in where
  // she sees it, so the panel closes (a request on its way is aborted).
  const { close } = controller;
  const insertable = editable && !sourceMode;
  useEffect(() => {
    if (!insertable) close({ focusEditor: false });
  }, [insertable, close]);

  const latest = useRef({ selected, sourceMode, editor, start: controller.start });
  latest.current = { selected, sourceMode, editor, start: controller.start };
  useEffect(
    () =>
      registerAiActionTarget({
        hasSelection: () => {
          const { sourceMode: source, editor: current } = latest.current;
          return !source && current !== null && hasMeaningfulSelection(current.state);
        },
        start: (action) => latest.current.start(action),
      }),
    [],
  );

  let blocker: AiBlocker | null = aiBlocker(status, path);
  if (!blocker && sourceMode) blocker = 'source-mode';
  if (!blocker && !editable) blocker = 'read-only';
  if (!blocker && !selected) blocker = 'no-selection';

  const available = status?.available === true;
  const start = controller.start;
  const toolbarItem = useMemo<ToolbarExtraItem | undefined>(
    () =>
      available
        ? {
            id: AI_MENU_ITEM_ID,
            widthRem: AI_MENU_WIDTH_REM,
            render: ({ tabIndex, tooltipProps }) => (
              <AiToolbarButton
                key={AI_MENU_ITEM_ID}
                tabIndex={tabIndex}
                tooltipProps={tooltipProps}
                blocker={blocker}
                onChoose={start}
                focusEditor={() => focusEditorNow(handle)}
              />
            ),
          }
        : undefined,
    [available, blocker, start, handle],
  );

  const panel = controller.state ? (
    <AiResultPanel
      controller={controller}
      state={controller.state}
      handle={handle}
      session={session}
    />
  ) : null;
  return { toolbarItem, panel };
}
