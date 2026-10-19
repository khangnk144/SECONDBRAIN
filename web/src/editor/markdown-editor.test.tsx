import { act, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../lib/testing/reset-app-state';
import { MarkdownEditor, type MarkdownEditorHandle } from './markdown-editor';
import { loadMarkdown, saveMarkdown } from './markdown/markdown-document';
import { editorSchema } from './schema/editor-schema';
import { createEditorHandle } from './editor-handle';
import { renderEditor } from './__tests__/render-editor';

function mount(source: string, editable = true) {
  const loaded = loadMarkdown(source);
  const onDocChange = vi.fn<(doc: ProseMirrorNode) => void>();
  let handle: MarkdownEditorHandle | null = null;
  const view = render(
    <MarkdownEditor
      initialDoc={loaded.doc}
      notePath="1 Projects/Đồ án.md"
      editable={editable}
      ariaLabel="Nội dung ghi chú"
      onDocChange={onDocChange}
      onReady={(h) => (handle = h)}
    />,
  );
  if (!handle) throw new Error('onReady was not called');
  return { loaded, onDocChange, handle: handle as MarkdownEditorHandle, ...view };
}

describe('MarkdownEditor', () => {
  beforeEach(async () => {
    await resetAppState();
  });

  it('builds the editor from the given document on the shared schema', () => {
    const { loaded, handle, getByRole } = mount('# Đồ án\n\nĐoạn một.\n');
    expect(handle.getDoc()).toBe(loaded.doc);
    expect(handle.getDoc().type.schema).toBe(editorSchema);
    const textbox = getByRole('textbox', { name: 'Nội dung ghi chú' });
    expect(textbox).toHaveAttribute('aria-multiline', 'true');
    expect(textbox.querySelector('h1')).toHaveTextContent('Đồ án');
  });

  it('reports document changes but not selection changes', () => {
    const { handle, onDocChange } = mount('Một.\n\nHai.\n');
    act(() => handle.focus('end'));
    expect(onDocChange).not.toHaveBeenCalled();
    act(() => handle.focus({ block: 0 }));
    expect(onDocChange).not.toHaveBeenCalled();
  });

  it('replaceDoc loads another document without reporting a change', () => {
    const { handle, onDocChange } = mount('Một.\n');
    const next = loadMarkdown('Hai.\n\n- [ ] việc\n');
    act(() => handle.replaceDoc(next.doc, { keepSelection: true }));
    expect(handle.getDoc()).toBe(next.doc);
    expect(onDocChange).not.toHaveBeenCalled();
    expect(saveMarkdown(handle.getDoc(), next.snapshot)).toBe('Hai.\n\n- [ ] việc\n');
  });

  it('focus({ block }) puts the caret at the start of that top-level block', () => {
    const { handle, getByRole } = mount('Một.\n\n## Hai\n\nBa.\n');
    act(() => handle.focus({ block: 1 }));
    const editor = (getByRole('textbox') as HTMLElement & { editor: Editor }).editor;
    const { $from } = editor.state.selection;
    expect($from.parent.type.name).toBe('heading');
    expect($from.parentOffset).toBe(0);
  });

  it('is read-only when not editable', () => {
    const { getByRole } = mount('Một.\n', false);
    const textbox = getByRole('textbox');
    expect(textbox).toHaveAttribute('contenteditable', 'false');
    expect(textbox).toHaveAttribute('aria-readonly', 'true');
  });

  it('replaceDoc closes an open popup', () => {
    const t = renderEditor('Xem\n');
    t.newLine();
    t.type('/');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    const next = loadMarkdown('Khác\n');
    const handle = createEditorHandle(t.editor);
    act(() => handle.replaceDoc(next.doc));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('switching to read-only disables the task checkboxes', () => {
    const loaded = loadMarkdown('- [ ] việc\n');
    const props = {
      initialDoc: loaded.doc,
      notePath: 'a.md',
      ariaLabel: 'Nội dung',
      onDocChange: () => undefined,
    };
    const { rerender, getByRole } = render(<MarkdownEditor {...props} editable />);
    expect(getByRole('checkbox')).toBeEnabled();
    rerender(<MarkdownEditor {...props} editable={false} />);
    expect(getByRole('checkbox')).toBeDisabled();
  });
});
