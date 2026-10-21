/**
 * Test helpers for AI on a selection: the real note screen (real editor, in-memory note server)
 * with a fake `runAiAction`, plus selection, menu and panel shortcuts.
 */
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { undo } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import { vi } from 'vitest';
import type { AiActionRequest } from '../../../lib/api/ai-types';

/** Requests `runAiAction` received, with the abort signal of each. */
export type RunAiAction = (
  request: AiActionRequest,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

export function realEditor(): Editor {
  const root = screen.getByRole('textbox', { name: /Nội dung ghi chú/ }) as HTMLElement & {
    editor?: Editor;
  };
  if (!root.editor) throw new Error('no Tiptap editor on the root');
  return root.editor;
}

/** Selects from the start of `start` to the end of `end` (both inside text nodes). */
export function selectText(start: string, end = start): void {
  const editor = realEditor();
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const text = node.text ?? '';
    if (from === -1 && text.includes(start)) from = pos + text.indexOf(start);
    if (from !== -1 && to === -1 && text.includes(end)) to = pos + text.indexOf(end) + end.length;
    return true;
  });
  if (from === -1 || to === -1) throw new Error(`text not found: ${start}…${end}`);
  act(() => {
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
    );
  });
}

export const toolbar = () => screen.getByRole('toolbar', { name: 'Định dạng' });
export const aiButton = () =>
  within(toolbar()).getByRole('button', { name: 'AI cho đoạn đã chọn' });
export const panel = () => screen.getByRole('dialog', { name: /./ });

/** Opens the AI menu with the mouse and picks `label`. */
export function chooseAction(label: string): void {
  fireEvent.mouseDown(aiButton());
  fireEvent.click(aiButton());
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
}

/** One undo step of the editor, as Ctrl+Z would take it. */
export function undoInEditor(): boolean {
  const editor = realEditor();
  let done = false;
  act(() => {
    done = undo(editor.state, (tr) => editor.view.dispatch(tr));
  });
  return done;
}

/** A request that stays open until its signal aborts (then rejects like fetch does). */
export function pendingUntilAborted(): RunAiAction {
  return (_request, options) =>
    new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      );
    });
}

export function lastRequest(mock: ReturnType<typeof vi.fn>): AiActionRequest | undefined {
  return mock.mock.calls.at(-1)?.[0] as AiActionRequest | undefined;
}
