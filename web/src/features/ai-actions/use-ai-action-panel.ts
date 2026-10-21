/**
 * The state behind the AI result panel of one note editor: checks before sending (nothing is
 * sent when AI is not ready, the note is out of scope or nothing is selected), one request per
 * click (abortable), and the selection kept in a `RangeTracker` until the result is used.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarkdownEditorHandle } from '../../editor/editor-handle';
import { hasMeaningfulSelection, selectionMarkdown } from '../../editor/selection-markdown';
import { runAiAction } from '../../lib/api/ai-api';
import type {
  AiActionRequest,
  AiLinkSuggestions,
  AiTagSuggestions,
  AiTextActionResponse,
} from '../../lib/api/ai-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { useAiStatusStore } from '../../lib/ai-status-store';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { MAX_SELECTION_CHARS, type AiEditorAction } from './ai-action-kinds';
import { EMPTY_ANSWER, isAbortError } from './ai-error-message';
import { focusEditorNow } from './apply-ai-result';
import { aiBlocker, type AiBlocker } from './ai-readiness';
import { RangeTracker } from './range-tracker';

export type PanelPhase =
  | { kind: 'blocked'; blocker: AiBlocker }
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown }
  | { kind: 'text'; text: string }
  | { kind: 'links'; links: AiLinkSuggestions['links'] }
  | { kind: 'tags'; tags: AiTagSuggestions['tags'] };

export interface PanelState {
  /** New for every request (focus follows it). */
  id: number;
  action: AiEditorAction;
  phase: PanelPhase;
  /** The selection as sent (the rewrite's word diff compares with it). */
  markdown: string;
  /** Viewport point just below the selection's end. */
  anchor: { left: number; top: number } | null;
}

export interface AiPanelController {
  state: PanelState | null;
  start: (action: AiEditorAction) => void;
  retry: () => void;
  /** Aborts a running request; the caret goes back to the editor unless told otherwise. */
  close: (options?: { focusEditor?: boolean }) => void;
  tracker: () => RangeTracker | null;
}

export interface PanelInputs {
  handle: MarkdownEditorHandle | null;
  path: () => VaultPath;
  /** Source mode or a read-only note: nothing can be inserted. */
  sourceMode: boolean;
  editable: boolean;
}

function resultPhase(action: AiEditorAction, result: unknown): PanelPhase {
  if (action === 'suggest-links')
    return { kind: 'links', links: (result as AiLinkSuggestions).links };
  if (action === 'suggest-tags') return { kind: 'tags', tags: (result as AiTagSuggestions).tags };
  const text = (result as AiTextActionResponse).text ?? '';
  return text.trim() === '' ? { kind: 'error', error: EMPTY_ANSWER } : { kind: 'text', text };
}

function anchorBelowSelection(handle: MarkdownEditorHandle): PanelState['anchor'] {
  const editor = handle.editor;
  if (!editor) return null;
  try {
    const coords = editor.view.coordsAtPos(editor.state.selection.to);
    return { left: coords.left, top: coords.bottom + 8 };
  } catch {
    return null; // no layout (hidden editor): the panel uses its default place
  }
}

export function useAiActionPanel(inputs: PanelInputs): AiPanelController {
  const [state, setState] = useState<PanelState | null>(null);
  const latest = useRef(inputs);
  latest.current = inputs;
  const seq = useRef(0);
  const live = useRef<{ abort: AbortController | null; tracker: RangeTracker | null }>({
    abort: null,
    tracker: null,
  });
  const body = useRef<AiActionRequest | null>(null);

  const stop = useCallback(() => {
    live.current.abort?.abort();
    live.current.abort = null;
  }, []);
  const dropTracker = useCallback(() => {
    live.current.tracker?.dispose();
    live.current.tracker = null;
  }, []);

  const send = useCallback((id: number, action: AiEditorAction, request: AiActionRequest) => {
    const controller = new AbortController();
    live.current.abort = controller;
    const settle = (phase: PanelPhase) => {
      if (controller.signal.aborted || seq.current !== id) return;
      live.current.abort = null;
      setState((current) => (current && current.id === id ? { ...current, phase } : current));
    };
    runAiAction(request, { signal: controller.signal }).then(
      (result) => {
        if (action === 'suggest-links' && useLinkTargetsStore.getState().status === 'idle') {
          void useLinkTargetsStore.getState().fetchTargets();
        }
        settle(resultPhase(action, result));
      },
      (error: unknown) => {
        if (!isAbortError(error)) settle({ kind: 'error', error });
      },
    );
  }, []);

  const start = useCallback(
    (action: AiEditorAction) => {
      const { handle, path, sourceMode, editable } = latest.current;
      const editor = handle?.editor;
      if (!handle || !editor || editor.isDestroyed) return;
      stop();
      dropTracker();
      const id = (seq.current += 1);
      const notePath = path();
      const status = useAiStatusStore.getState().status;
      const base = { id, action, markdown: '', anchor: anchorBelowSelection(handle) };
      let blocker: AiBlocker | null = aiBlocker(status, notePath);
      if (!blocker && sourceMode) blocker = 'source-mode';
      if (!blocker && !editable) blocker = 'read-only';
      if (!blocker && !hasMeaningfulSelection(editor.state)) blocker = 'no-selection';
      const markdown = blocker ? '' : selectionMarkdown(editor.state);
      if (!blocker && markdown.trim() === '') blocker = 'no-selection';
      if (!blocker && markdown.length > MAX_SELECTION_CHARS) blocker = 'too-long';
      if (blocker) {
        body.current = null;
        setState({ ...base, phase: { kind: 'blocked', blocker } });
        return;
      }
      const { from, to } = editor.state.selection;
      live.current.tracker = new RangeTracker(editor, from, to);
      const request = { action, text: markdown, path: notePath } as AiActionRequest;
      body.current = request;
      setState({ ...base, markdown, phase: { kind: 'loading' } });
      send(id, action, request);
    },
    [dropTracker, send, stop],
  );

  const retry = useCallback(() => {
    const request = body.current;
    if (!request || !state) return;
    stop();
    const id = (seq.current += 1);
    setState({ ...state, id, phase: { kind: 'loading' } });
    send(id, state.action, request);
  }, [send, state, stop]);

  const close = useCallback(
    (options: { focusEditor?: boolean } = {}) => {
      stop();
      dropTracker();
      seq.current += 1;
      body.current = null;
      setState(null);
      if (options.focusEditor !== false) focusEditorNow(latest.current.handle);
    },
    [dropTracker, stop],
  );

  useEffect(
    () => () => {
      stop();
      dropTracker();
    },
    [dropTracker, stop],
  );

  const tracker = useCallback(() => live.current.tracker, []);
  return { state, start, retry, close, tracker };
}
