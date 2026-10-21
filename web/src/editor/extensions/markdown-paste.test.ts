import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { saveMarkdown } from '../markdown/markdown-document';
import {
  createTestEditor,
  newLineAtEnd,
  placeCaret,
  type TestEditor,
} from '../__tests__/editor-test-utils';
import { looksLikeMarkdown } from './markdown-paste';

let current: TestEditor | null = null;

function clipboard(data: Record<string, string>, files: { type: string }[] = []): ClipboardEvent {
  const items = [
    ...Object.keys(data).map((type) => ({ kind: 'string', type })),
    ...files.map((file) => ({ kind: 'file', type: file.type })),
  ];
  return {
    clipboardData: { getData: (type: string) => data[type] ?? '', items },
  } as unknown as ClipboardEvent;
}

function pasteText(t: TestEditor, text: string): void {
  t.view.pasteText(text, clipboard({ 'text/plain': text }));
}

function saved(t: TestEditor): string {
  return saveMarkdown(t.editor.state.doc, t.loaded.snapshot);
}

describe('paste', () => {
  beforeEach(async () => {
    await resetAppState();
  });
  afterEach(() => {
    current?.editor.destroy();
    current = null;
  });

  it.each([
    ['## Tiêu đề', true],
    ['- [ ] việc', true],
    ['đoạn có **đậm**', true],
    ['xem [[Giải tích 1]]', true],
    ['chữ <u>gạch chân</u> ở đây', true],
    ['một câu bình thường, không có gì đặc biệt.', false],
    ['giá 5*3 = 15', false],
  ])('looksLikeMarkdown(%s) = %s', (text, expected) => {
    expect(looksLikeMarkdown(text)).toBe(expected);
  });

  it('Markdown text on an empty line becomes blocks', () => {
    current = createTestEditor('Mở đầu.\n');
    newLineAtEnd(current.editor);
    pasteText(
      current,
      '## Ôn tập\n\n- [ ] Đọc chương 2 📅 2026-10-20\n- [x] Làm bài 1\n\n> Ghi nhớ [[Giải tích 1]]',
    );
    const names: string[] = [];
    current.editor.state.doc.forEach((n) => names.push(n.type.name));
    expect(names).toEqual(['paragraph', 'heading', 'taskList', 'blockquote']);
    expect(saved(current)).toBe(
      'Mở đầu.\n\n## Ôn tập\n\n- [ ] Đọc chương 2 📅 2026-10-20\n- [x] Làm bài 1\n\n> Ghi nhớ [[Giải tích 1]]\n',
    );
  });

  it('one line of Markdown is pasted inline, with marks and links', () => {
    current = createTestEditor('Trước sau\n');
    placeCaret(current.editor, 'Trước ');
    pasteText(current, '**đậm** và [[Ghi chú]] ');
    const paragraph = current.editor.state.doc.firstChild!;
    expect(current.editor.state.doc.childCount).toBe(1);
    expect(paragraph.textContent).toBe('Trước đậm và  sau');
    expect(saved(current)).toBe('Trước **đậm** và [[Ghi chú]] sau\n');
  });

  it('underline survives a paste as plain Markdown text and as HTML', () => {
    current = createTestEditor('A\n');
    placeCaret(current.editor, 'A');
    pasteText(current, ' và <u>gạch chân</u>');
    expect(saved(current)).toBe('A và <u>gạch chân</u>\n');
    newLineAtEnd(current.editor);
    const html = '<p>Chữ <u>gạch</u> và <span style="text-decoration: underline">kẻ</span></p>';
    current.view.pasteHTML(html, clipboard({ 'text/html': html }));
    expect(saved(current)).toBe('A và <u>gạch chân</u>\n\nChữ <u>gạch</u> và <u>kẻ</u>\n');
  });

  it('plain text without Markdown is left to the default paste', () => {
    current = createTestEditor('A\n');
    placeCaret(current.editor, 'A');
    pasteText(current, ' cộng B');
    expect(saved(current)).toBe('A cộng B\n');
  });

  it('HTML is limited to the schema and its images are left out', () => {
    current = createTestEditor('A\n');
    newLineAtEnd(current.editor);
    const html = '<h2>Tiêu đề</h2><p>Chữ <b>đậm</b><img src="https://x/y.png"></p><font>lạ</font>';
    current.view.pasteHTML(html, clipboard({ 'text/html': html }));
    let images = 0;
    current.editor.state.doc.descendants((n) => {
      if (n.type.name === 'image') images += 1;
    });
    expect(images).toBe(0);
    expect(current.editor.state.doc.child(1).type.name).toBe('heading');
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      'Ảnh trong nội dung dán từ web không được giữ lại. Lưu ảnh về máy rồi kéo vào ghi chú.',
    ]);
  });
});
