import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { installRangeLayoutShim } from '../__tests__/jsdom-layout';
import { placeCaret } from '../__tests__/editor-test-utils';
import { MarkdownEditor } from '../markdown-editor';
import { loadMarkdown, saveMarkdown } from '../markdown/markdown-document';
import { FormattingToolbar } from './formatting-toolbar';

const SOURCE = 'Một chữ **đậm** ở đây.\n\n#### Mục cấp 4\n';

function Harness({ sourceMode = false, onToggle }: { sourceMode?: boolean; onToggle: () => void }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loaded] = useState(() => loadMarkdown(SOURCE));
  const field = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <FormattingToolbar
        editor={editor}
        sourceMode={sourceMode}
        canToggleSource
        onToggleSource={onToggle}
        sourceField={field}
      />
      <MarkdownEditor
        initialDoc={loaded.doc}
        notePath="1 Projects/Đồ án.md"
        editable
        ariaLabel="Nội dung ghi chú"
        onDocChange={() => undefined}
        onReady={(handle) => setEditor(handle.editor ?? null)}
      />
    </>
  );
}

function setup(sourceMode = false) {
  const onToggle = vi.fn();
  const view = render(<Harness sourceMode={sourceMode} onToggle={onToggle} />);
  const root = screen.getByRole('textbox', { name: 'Nội dung ghi chú' });
  const editor = (root as HTMLElement & { editor: Editor }).editor;
  const toolbar = screen.getByRole('toolbar', { name: 'Định dạng' });
  const button = (name: string | RegExp) => within(toolbar).getByRole('button', { name });
  const saved = () => saveMarkdown(editor.state.doc, loadMarkdown(SOURCE).snapshot);
  const select = (text: string) =>
    act(() => {
      placeCaret(editor, text, 'before');
      const { from } = editor.state.selection;
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, from, from + text.length),
        ),
      );
    });
  return { ...view, onToggle, root, editor, toolbar, button, saved, select };
}

describe('formatting toolbar', () => {
  beforeAll(installRangeLayoutShim);
  beforeEach(async () => {
    await resetAppState();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows every command of the registry with its label and shortcut', () => {
    const { button } = setup();
    // No native title: the shortcut shows in the toolbar's own tooltip (see below).
    expect(button('Đậm')).not.toHaveAttribute('title');
    expect(button('Gạch chân')).toHaveAttribute('aria-keyshortcuts', 'Control+U');
    expect(button('Làm lại chỉnh sửa')).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Y Control+Shift+Z',
    );
    expect(button('Kiểu chữ: Đoạn văn')).toHaveAttribute('aria-haspopup', 'menu');
    for (const name of [
      'Hoàn tác chỉnh sửa',
      'Nghiêng',
      'Gạch ngang',
      'Code',
      'Danh sách chấm',
      'Danh sách số',
      'Việc cần làm',
      'Trích dẫn',
      'Khối code',
      'Đường kẻ',
      'Bảng',
      'Liên kết web',
      'Liên kết ghi chú',
      'Xóa định dạng',
      'Chế độ nguồn',
    ]) {
      expect(button(name)).toBeInTheDocument();
    }
  });

  it('is one Tab stop; arrows, Home and End move between the controls', () => {
    const { toolbar, button } = setup();
    const items = Array.from(toolbar.querySelectorAll<HTMLElement>('[data-toolbar-item]'));
    expect(items.filter((item) => item.tabIndex === 0)).toEqual([button('Hoàn tác chỉnh sửa')]);
    act(() => button('Hoàn tác chỉnh sửa').focus());
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(button('Làm lại chỉnh sửa'));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(button('Chế độ nguồn'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(button('Hoàn tác chỉnh sửa'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(button('Chế độ nguồn'));
    expect(button('Chế độ nguồn').tabIndex).toBe(0);
    expect(button('Hoàn tác chỉnh sửa').tabIndex).toBe(-1);
  });

  it('pressed state follows the selection', () => {
    const { button, editor } = setup();
    act(() => placeCaret(editor, 'đậ'));
    expect(button('Đậm')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Nghiêng')).toHaveAttribute('aria-pressed', 'false');
    act(() => placeCaret(editor, 'Một'));
    expect(button('Đậm')).toHaveAttribute('aria-pressed', 'false');
  });

  it('a click keeps the selection, applies the command and gives focus back to the editor', async () => {
    const { button, select, saved, root } = setup();
    select('chữ');
    const pressed = fireEvent.mouseDown(button('Gạch chân'));
    expect(pressed).toBe(false); // default prevented: the button never takes focus
    fireEvent.click(button('Gạch chân'));
    expect(saved()).toBe('Một <u>chữ</u> **đậm** ở đây.\n\n#### Mục cấp 4\n');
    // Tiptap focuses the editor in the next animation frame.
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(document.activeElement).toBe(root);
    expect(button('Gạch chân')).toHaveAttribute('aria-pressed', 'true');
  });

  it('is disabled (not removed) on a verbatim block', () => {
    const { button, editor, saved } = setup();
    const at = editor.state.doc.child(0).nodeSize;
    act(() => {
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, at)),
      );
    });
    expect(button('Đậm')).toHaveAttribute('aria-disabled', 'true');
    expect(button('Bảng')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button('Đậm'));
    expect(saved()).toBe(SOURCE);
  });

  it('the text style menu sets a heading', () => {
    const { button, editor, saved } = setup();
    act(() => placeCaret(editor, 'Một'));
    fireEvent.click(button('Kiểu chữ: Đoạn văn'));
    const menu = screen.getByRole('menu', { name: 'Kiểu chữ' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Tiêu đề 2/ }));
    expect(saved()).toBe('## Một chữ **đậm** ở đây.\n\n#### Mục cấp 4\n');
    expect(button('Kiểu chữ: Tiêu đề 2')).toBeInTheDocument();
  });

  it('in source mode only undo, redo and the source switch are enabled', () => {
    const { toolbar, button, onToggle } = setup(true);
    const enabled = Array.from(toolbar.querySelectorAll<HTMLElement>('[data-toolbar-item]'))
      .filter((item) => item.getAttribute('aria-disabled') !== 'true')
      .map((item) => item.getAttribute('aria-label'));
    expect(enabled).toEqual(['Hoàn tác chỉnh sửa', 'Làm lại chỉnh sửa', 'Chế độ nguồn']);
    expect(button('Chế độ nguồn')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button('Chế độ nguồn'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('on a narrow screen the less-used commands sit in "Thêm"', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('formatting-toolbar') ? 328 : 0;
    });
    const { toolbar, button, select, saved } = setup();
    expect(within(toolbar).queryByRole('button', { name: 'Gạch ngang' })).toBeNull();
    select('chữ');
    fireEvent.click(button('Thêm'));
    const menu = screen.getByRole('menu', { name: 'Các lệnh định dạng khác' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Gạch ngang/ }));
    expect(saved()).toBe('Một ~~chữ~~ **đậm** ở đây.\n\n#### Mục cấp 4\n');
  });

  it('shows the shortcut in a tooltip on keyboard focus, below the button; Esc hides it', () => {
    const { button } = setup();
    act(() => button('Hoàn tác chỉnh sửa').focus());
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    let tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Hoàn tác chỉnh sửaCtrl+Z');
    expect(button('Hoàn tác chỉnh sửa')).toHaveAccessibleDescription('Ctrl+Z');
    // Roving focus moves the tooltip with it.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Làm lại chỉnh sửaCtrl+Y');
    expect(tip.style.top).not.toBe('');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(document.activeElement).toBe(button('Làm lại chỉnh sửa'));
  });

  it('shows the tooltip on hover after a short wait, and hides it on leave or press', () => {
    vi.useFakeTimers();
    try {
      const { button } = setup();
      fireEvent.pointerEnter(button('Đậm'), { pointerType: 'mouse' });
      expect(screen.queryByRole('tooltip')).toBeNull();
      act(() => vi.advanceTimersByTime(400));
      expect(screen.getByRole('tooltip')).toHaveTextContent('ĐậmCtrl+B');
      // Moving along the toolbar shows the next one at once.
      fireEvent.pointerLeave(button('Đậm'), { pointerType: 'mouse' });
      fireEvent.pointerEnter(button('Nghiêng'), { pointerType: 'mouse' });
      expect(screen.getByRole('tooltip')).toHaveTextContent('NghiêngCtrl+I');
      fireEvent.pointerDown(button('Nghiêng'), { pointerType: 'mouse' });
      expect(screen.queryByRole('tooltip')).toBeNull();
      fireEvent.pointerEnter(button('Bảng'), { pointerType: 'mouse' });
      expect(screen.getByRole('tooltip')).toHaveTextContent(/^Bảng$/);
      fireEvent.pointerLeave(button('Bảng'), { pointerType: 'mouse' });
      act(() => vi.advanceTimersByTime(200));
      expect(screen.queryByRole('tooltip')).toBeNull();
      // Touch never shows it.
      fireEvent.pointerEnter(button('Đậm'), { pointerType: 'touch' });
      act(() => vi.advanceTimersByTime(1_000));
      expect(screen.queryByRole('tooltip')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the tooltip inside a 360 px window', () => {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(360);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(140);
    const { button } = setup();
    const target = button('Chế độ nguồn');
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 330, y: 8, width: 32, height: 36 }),
    );
    act(() => target.focus());
    const tip = screen.getByRole('tooltip');
    expect(parseFloat(tip.style.left)).toBe(360 - 140 - 8);
    expect(parseFloat(tip.style.top)).toBe(8 + 36 + 6);
  });
});
