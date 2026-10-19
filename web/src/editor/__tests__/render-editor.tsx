/** Test helper: the real `<MarkdownEditor>` with typing and keys wrapped in `act()`. */
import { act, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { vi } from 'vitest';
import { MarkdownEditor } from '../markdown-editor';
import { loadMarkdown } from '../markdown/markdown-document';
import { newLineAtEnd, placeCaret, pressKey, typeText, type KeyOptions } from './editor-test-utils';

export function renderEditor(source: string, notePath = '1 Projects/Đồ án.md') {
  const loaded = loadMarkdown(source);
  const onDocChange = vi.fn<(doc: ProseMirrorNode) => void>();
  const view = render(
    <MarkdownEditor
      initialDoc={loaded.doc}
      notePath={notePath}
      editable
      ariaLabel="Nội dung ghi chú"
      onDocChange={onDocChange}
    />,
  );
  const root = screen.getByRole('textbox', { name: 'Nội dung ghi chú' });
  const editor = (root as HTMLElement & { editor: Editor }).editor;
  return {
    ...view,
    loaded,
    editor,
    root,
    onDocChange,
    type: (text: string) => act(() => typeText(editor, text)),
    press: (key: string, options?: KeyOptions) => {
      let handled = false;
      act(() => {
        handled = pressKey(editor, key, options);
      });
      return handled;
    },
    newLine: () => act(() => newLineAtEnd(editor)),
    caretAfter: (text: string) => act(() => placeCaret(editor, text)),
  };
}
