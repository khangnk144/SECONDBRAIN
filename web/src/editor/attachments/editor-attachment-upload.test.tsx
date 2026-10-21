import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { resetVaultFileBlobs } from '../../lib/vault-file-blob';
import { vaultStorage } from '../../lib/vault-storage';
import { installRangeLayoutShim } from '../__tests__/jsdom-layout';
import { newLineAtEnd, placeCaret } from '../__tests__/editor-test-utils';
import { renderEditor } from '../__tests__/render-editor';
import { saveMarkdown } from '../markdown/markdown-document';
import {
  dropEvent,
  file,
  installObjectUrls,
  installUploadServer,
  pasteEvent,
  uploadResponse,
  type FakeObjectUrls,
  type RecordedUpload,
} from './attachment-test-kit';
import { DocumentTargetChooserHost } from './document-target-chooser';
import { DOCUMENT_TARGET_STORAGE_KEY, resetDocumentTargetRequests } from './document-target-store';

const NOTE = [
  '---',
  'type: lecture   # môn học',
  'course: "[[Giải tích 1]]"',
  '---',
  '# Bài 3',
  '',
  'Ghi chép *đầu* giờ.  ',
  '',
].join('\r\n');

function setup(source = NOTE) {
  const t = renderEditor(source);
  render(<DocumentTargetChooserHost />);
  const saved = () => saveMarkdown(t.editor.state.doc, t.loaded.snapshot);
  const drop = (files: File[]) => act(() => void t.editor.view.dom.dispatchEvent(dropEvent(files)));
  return { ...t, saved, drop };
}

function emptyLineAtEnd(editor: Editor) {
  act(() => newLineAtEnd(editor));
}

describe('dropping and pasting files into the editor (F15.1)', () => {
  let mock: FetchMock;
  let uploads: RecordedUpload[];
  let urls: FakeObjectUrls;

  beforeEach(async () => {
    await resetAppState();
    resetVaultFileBlobs();
    installRangeLayoutShim();
    mock = installFetchMock();
    mock.on('GET /api/files', apiError(404, 'NOT_FOUND'));
    uploads = installUploadServer(mock);
    urls = installObjectUrls();
  });
  afterEach(() => {
    resetDocumentTargetRequests();
    resetVaultFileBlobs();
    urls.restore();
    vi.unstubAllGlobals();
  });

  it('uploads a dropped image with target auto and adds exactly its line, CRLF and YAML intact', async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    uploads = installUploadServer(mock, async (upload) => {
      await gate;
      return { status: 201, body: uploadResponse(`Attachments/2026-10/${upload.file.name}`) };
    });
    const t = setup();
    emptyLineAtEnd(t.editor);
    t.drop([file('image.png')]);
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0]!.target).toBe('auto');
    expect(uploads[0]!.file.name).toBe('image.png');
    // While it uploads: a marker in the editor, nothing in the document.
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải lên image.png…');
    expect(t.saved()).toBe(NOTE);
    release();
    await waitFor(() => expect(t.saved()).toBe(NOTE + '\r\n![[image.png]]\r\n'));
    expect(document.querySelector('.upload-placeholder')).toBeNull();
  });

  it('two images with the same name get the distinct links the server returns, in order', async () => {
    const names = ['image.png', 'image 2.png'];
    uploads = installUploadServer(mock, (_upload, index) => ({
      status: 201,
      body: uploadResponse(`Attachments/2026-1${index}/${names[index]}`),
    }));
    const t = setup('Mở đầu\n');
    emptyLineAtEnd(t.editor);
    t.drop([file('image.png'), file('image.png')]);
    await waitFor(() => expect(t.saved()).toBe('Mở đầu\n\n![[image.png]]\n\n![[image 2.png]]\n'));
    expect(uploads.map((u) => u.file.name)).toEqual(['image.png', 'image.png']);
  });

  it('asks where a document goes, remembers the answer, and Esc cancels that drop', async () => {
    const t = setup('Mở đầu\n');
    emptyLineAtEnd(t.editor);
    t.drop([file('bài giảng 3.docx')]);
    const dialog = await screen.findByRole('dialog', { name: 'Lưu vào' });
    expect(dialog).toHaveTextContent('bài giảng 3.docx');
    expect(screen.getByRole('radio', { name: /Tài liệu khác/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Bài báo \(papers\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0]!.target).toBe('papers');
    await waitFor(() => expect(t.saved()).toBe('Mở đầu\n\n[[bài giảng 3.docx]]\n'));
    expect(vaultStorage.get(DOCUMENT_TARGET_STORAGE_KEY, null)).toBe('papers');

    // Next time the remembered folder is preselected, whatever the file type; Esc drops it.
    t.drop([file('slide tuần 4.pptx')]);
    await screen.findByRole('dialog', { name: 'Lưu vào' });
    expect(screen.getByRole('radio', { name: /Bài báo/ })).toBeChecked();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(uploads).toHaveLength(1);
    expect(document.querySelector('.upload-placeholder')).toBeNull();
    expect(t.saved()).toBe('Mở đầu\n\n[[bài giảng 3.docx]]\n');
  });

  it('one choice covers every document of a drop; images go first without waiting', async () => {
    const t = setup('Mở đầu\n');
    emptyLineAtEnd(t.editor);
    t.drop([file('a.pdf'), file('sơ đồ.png'), file('b.pptx')]);
    const dialog = await screen.findByRole('dialog', { name: 'Lưu vào' });
    expect(dialog).toHaveTextContent('2 tệp');
    await waitFor(() => expect(t.saved()).toBe('Mở đầu\n\n![[sơ đồ.png]]\n'));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(t.saved()).toBe('Mở đầu\n\n[[a.pdf]]\n\n![[sơ đồ.png]]\n\n[[b.pptx]]\n'),
    );
    expect(uploads.map((u) => [u.file.name, u.target])).toEqual([
      ['sơ đồ.png', 'auto'],
      ['a.pdf', 'papers'],
      ['b.pptx', 'papers'],
    ]);
  });

  it('the inserted image shows at once, without a "not found" flash', async () => {
    useLinkTargetsStore.getState().setTargets([], []);
    mock.on('GET /api/files', { body: {} });
    const t = setup('Mở đầu\n');
    emptyLineAtEnd(t.editor);
    t.drop([file('bảng.png')]);
    await waitFor(() =>
      expect(t.container.querySelector('img.embed-image__img')).toHaveAttribute(
        'src',
        'blob:test/1',
      ),
    );
    expect(t.container).not.toHaveTextContent('Không tìm thấy');
  });

  it('a pasted screenshot is uploaded and its link goes in at the caret', async () => {
    const t = setup('Xem hình nhé\n');
    act(() => placeCaret(t.editor, 'Xem hình'));
    const screenshot = new File(['png'], '', { type: 'image/png' });
    act(() => void t.editor.view.dom.dispatchEvent(pasteEvent([screenshot])));
    await waitFor(() => expect(t.saved()).toBe('Xem hình ![[image.png]] nhé\n'));
    expect(uploads[0]!.file.name).toBe('image.png');
  });

  it('a failed upload shows what happened and inserts nothing', async () => {
    mock.on('POST /api/attachments', apiError(413, 'VALIDATION'));
    const t = setup('Mở đầu\n');
    emptyLineAtEnd(t.editor);
    t.drop([file('quay màn hình.png')]);
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const toast = useToastStore.getState().toasts[0]!;
    expect(toast.message).toBe('Không tải lên được quay màn hình.png: tệp lớn hơn 200 MB.');
    expect(toast.tone).toBe('error');
    expect(document.querySelector('.upload-placeholder')).toBeNull();
    expect(t.saved()).toBe('Mở đầu\n');
    expect(t.onDocChange).toHaveBeenCalledTimes(1); // the empty line only
  });

  it('each inserted link is one undo step', async () => {
    const t = setup('Mở đầu\n');
    emptyLineAtEnd(t.editor);
    t.drop([file('a.png'), file('b.png')]);
    await waitFor(() => expect(t.saved()).toBe('Mở đầu\n\n![[a.png]]\n\n![[b.png]]\n'));
    act(() => void t.editor.commands.undo());
    expect(t.saved()).toBe('Mở đầu\n\n![[a.png]]\n');
    act(() => void t.editor.commands.undo());
    expect(t.saved()).toBe('Mở đầu\n');
  });

  it('the slash menu\'s "Ảnh" picks images and uploads them at the caret', async () => {
    const picked = [file('bảng 1.png')];
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      expect(this.accept).toContain('image/png');
      Object.defineProperty(this, 'files', { value: picked });
      this.dispatchEvent(new Event('change'));
    });
    const t = setup('Mở đầu\n');
    emptyLineAtEnd(t.editor);
    t.type('/ảnh');
    fireEvent.click(screen.getByRole('option', { name: /Ảnh/ }));
    await waitFor(() => expect(t.saved()).toBe('Mở đầu\n\n![[bảng 1.png]]\n'));
    expect(uploads.map((u) => u.target)).toEqual(['auto']);
    click.mockRestore();
  });

  it('leaves drops and pastes without files to the editor', () => {
    const t = setup('A\n');
    const event = dropEvent([], { 'text/plain': 'chữ kéo vào' });
    const answers: unknown[] = [];
    t.editor.view.someProp('handleDOMEvents', (handlers) => {
      if (handlers.drop) answers.push(handlers.drop(t.editor.view, event as DragEvent));
      return false;
    });
    expect(answers).not.toContain(true);
    expect(event.defaultPrevented).toBe(false);
    expect(uploads).toHaveLength(0);
  });
});
