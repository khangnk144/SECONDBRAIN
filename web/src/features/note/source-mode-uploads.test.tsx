import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  file,
  installUploadServer,
  pasteEvent,
  filesTransfer,
  type RecordedUpload,
} from '../../editor/attachments/attachment-test-kit';
import { DocumentTargetChooserHost } from '../../editor/attachments/document-target-chooser';
import { resetDocumentTargetRequests } from '../../editor/attachments/document-target-store';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { SourceModeEditor } from './source-mode-editor';
import { linkWithSpaces, mapOffset } from './source-mode-uploads';

function SourceHarness({ initial, onText }: { initial: string; onText: (text: string) => void }) {
  const [text, setText] = useState(initial);
  return (
    <>
      <SourceModeEditor
        text={text}
        readOnly={false}
        onChange={(next) => {
          setText(next);
          onText(next);
        }}
      />
      <DocumentTargetChooserHost />
    </>
  );
}

function mount(initial: string) {
  const onText = vi.fn<(text: string) => void>();
  render(<SourceHarness initial={initial} onText={onText} />);
  const field = screen.getByRole('textbox', { name: /chế độ nguồn/ }) as HTMLTextAreaElement;
  return { field, onText };
}

describe('source mode helpers', () => {
  it('maps an offset across one edit', () => {
    expect(mapOffset('abc def', 'abc XX def', 7)).toBe(10);
    expect(mapOffset('abc def', 'abc XX def', 2)).toBe(2);
    expect(mapOffset('abc def', 'ab', 5)).toBe(2);
  });

  it('puts a space between the link and touching text only', () => {
    expect(linkWithSpaces('', 0, '[[a.pdf]]').text).toBe('[[a.pdf]]');
    expect(linkWithSpaces('xem\n', 3, '[[a.pdf]]').text).toBe(' [[a.pdf]]');
    expect(linkWithSpaces('xem nhé', 3, '[[a.pdf]]')).toEqual({ text: ' [[a.pdf]]', linkEnd: 10 });
    expect(linkWithSpaces('xemnhé', 3, '[[a.pdf]]').text).toBe(' [[a.pdf]] ');
  });
});

describe('dropping files into source mode (F15.1)', () => {
  let mock: FetchMock;
  let uploads: RecordedUpload[];

  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
    uploads = installUploadServer(mock);
  });
  afterEach(() => {
    resetDocumentTargetRequests();
    vi.unstubAllGlobals();
  });

  it('inserts the returned link text at the caret through the same upload flow', async () => {
    const { field, onText } = mount('# Bài 3\n\nGhi chép\n');
    field.focus();
    field.setSelectionRange(9, 9);
    fireEvent.drop(field, { dataTransfer: filesTransfer([file('bài giảng 3.pdf')]) });
    expect(await screen.findByRole('dialog', { name: 'Lưu vào' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(onText).toHaveBeenLastCalledWith('# Bài 3\n\n[[bài giảng 3.pdf]] Ghi chép\n'),
    );
    expect(uploads[0]!.target).toBe('papers');
    expect(field.value).toBe('# Bài 3\n\n[[bài giảng 3.pdf]] Ghi chép\n');
  });

  it('shows the upload outside the text and keeps typing done meanwhile', async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    uploads = installUploadServer(mock, async () => {
      await gate;
      return {
        status: 201,
        body: {
          path: 'Attachments/2026-10/a.png',
          name: 'a.png',
          kind: 'image',
          link: '![[a.png]]',
        },
      };
    });
    const { field, onText } = mount('Hình:\n');
    field.setSelectionRange(6, 6);
    act(() => void field.dispatchEvent(pasteEvent([file('a.png')])));
    await waitFor(() => expect(screen.getByText('Đang tải lên a.png…')).toBeInTheDocument());
    // Typing before the drop point while the file uploads.
    fireEvent.change(field, { target: { value: 'Các hình:\n' } });
    release();
    await waitFor(() => expect(onText).toHaveBeenLastCalledWith('Các hình:\n![[a.png]]'));
    expect(screen.queryByText('Đang tải lên a.png…')).toBeNull();
  });

  it('a failed upload changes nothing and says why', async () => {
    mock.on('POST /api/attachments', apiError(400, 'VALIDATION'));
    const { field, onText } = mount('A\n');
    fireEvent.drop(field, { dataTransfer: filesTransfer([file('CON.png')]) });
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(useToastStore.getState().toasts[0]!.message).toBe(
      'Không tải lên được CON.png: tên hoặc nội dung tệp không dùng được. Đổi tên tệp rồi thử lại.',
    );
    expect(onText).not.toHaveBeenCalled();
  });

  it('text drops are left to the text field', () => {
    const { field } = mount('A\n');
    const notCancelled = fireEvent.drop(field, {
      dataTransfer: filesTransfer([], { 'text/plain': 'chữ' }),
    });
    expect(notCancelled).toBe(true);
    expect(uploads).toHaveLength(0);
  });
});
