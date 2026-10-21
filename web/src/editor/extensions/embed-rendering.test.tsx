import { act, fireEvent, waitFor } from '@testing-library/react';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setApiToken } from '../../lib/api';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { setOpenVaultFileImplementation } from '../../lib/open-vault-file';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { resetVaultFileBlobs } from '../../lib/vault-file-blob';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { installObjectUrls, type FakeObjectUrls } from '../attachments/attachment-test-kit';
import { pressKey } from '../__tests__/editor-test-utils';
import { renderEditor } from '../__tests__/render-editor';

const FILES = [
  'Attachments/2026-10/sơ đồ.png',
  'Attachments/2026-10/hình vẽ.svg',
  '1 Projects/hình/ảnh tương đối.png',
  '3 Resources/papers/bài giảng 3.pdf',
  '3 Resources/other/trang lưu.html',
];

function setTargets(files: string[]) {
  useLinkTargetsStore.getState().setTargets(
    [
      {
        path: '2 Areas/Giải tích 1.md',
        title: 'Giải tích 1',
        folder: '2 Areas',
        class: 'user',
        unique: true,
      },
    ],
    files.map((path) => ({ path, name: path.slice(path.lastIndexOf('/') + 1) })),
  );
}

function fileRequests(mock: FetchMock): string[] {
  return mock.callsTo('GET /api/files').map((call) => call.query.get('path') ?? '');
}

describe('images and files inside notes (F15.2, F15.3)', () => {
  let mock: FetchMock;
  let urls: FakeObjectUrls;
  const opened = vi.fn();

  beforeEach(async () => {
    await resetAppState();
    resetVaultFileBlobs();
    setApiToken('tok-1');
    mock = installFetchMock();
    mock.on('GET /api/files', (call) =>
      FILES.includes(call.query.get('path') ?? '') ? { body: {} } : apiError(404, 'NOT_FOUND'),
    );
    urls = installObjectUrls();
    setTargets(FILES);
    opened.mockReset();
    setOpenVaultFileImplementation(opened);
  });
  afterEach(() => {
    setOpenVaultFileImplementation(null);
    resetVaultFileBlobs();
    setApiToken(null);
    urls.restore();
    vi.unstubAllGlobals();
  });

  it('shows an embedded image through a token-fetched object URL', async () => {
    const t = renderEditor('Trước\n\n![[sơ đồ.png]]\n');
    const img = await waitFor(() => {
      const found = t.container.querySelector('img.embed-image__img');
      expect(found).toHaveAttribute('src', 'blob:test/1');
      return found!;
    });
    expect(img).toHaveAttribute('alt', 'sơ đồ.png');
    expect(fileRequests(mock)).toEqual(['Attachments/2026-10/sơ đồ.png']);
    const init = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).startsWith('/api/files'))?.[1];
    expect((init?.headers as Record<string, string>)['X-SB-Token']).toBe('tok-1');
  });

  it('renders SVG only as an <img>, never as inline markup', async () => {
    const t = renderEditor('![[hình vẽ.svg]]\n');
    await waitFor(() =>
      expect(t.container.querySelector('img.embed-image__img')).toHaveAttribute(
        'src',
        'blob:test/1',
      ),
    );
    const embed = t.container.querySelector('.wikilink')!;
    expect(embed.querySelector('svg')).toBeNull();
  });

  it('names a missing image in a placeholder the keyboard can select', async () => {
    const t = renderEditor('![[bài giảng 3.png]] và ![[mất rồi.png]]\n');
    setTargets([...FILES, 'Attachments/2026-10/mất rồi.png']);
    const missing = t.container.querySelector('[role="img"]');
    expect(missing).toHaveAccessibleName('Không tìm thấy ảnh bài giảng 3.png');
    // In the link targets but gone from disk: the 404 gives the same placeholder.
    await waitFor(() =>
      expect(t.container.querySelectorAll('[role="img"]')[1]).toHaveTextContent(
        'Không tìm thấy ảnh mất rồi.png',
      ),
    );
    expect(fileRequests(mock)).toEqual(['Attachments/2026-10/mất rồi.png']);
    act(() => {
      t.editor.view.dispatch(
        t.editor.state.tr.setSelection(NodeSelection.create(t.editor.state.doc, 1)),
      );
    });
    expect(t.container.querySelector('.wikilink')).toHaveClass('is-selected');
    act(() => void pressKey(t.editor, 'Enter'));
    expect(useToastStore.getState().toasts[0]?.message).toBe(
      'Không tìm thấy tệp bài giảng 3.png trong kho. Có thể tệp đã bị đổi tên hoặc xóa; hãy sửa liên kết, hoặc thêm lại tệp vào kho.',
    );
  });

  it('never fetches web images: a quiet placeholder shows the address', () => {
    const t = renderEditor('![logo](https://example.com/logo.png)\n');
    expect(t.container.querySelector('img.embed-image__img')).toBeNull();
    expect(t.container).toHaveTextContent(
      'Ảnh từ web không được tải: https://example.com/logo.png',
    );
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).not.toContain(
      'https://example.com/logo.png',
    );
  });

  it('resolves Markdown images next to the note first, then from the vault root', async () => {
    const t = renderEditor(
      '![sơ đồ lớp](hình/ảnh%20tương%20đối.png) ![](Attachments/2026-10/sơ%20đồ.png)\n',
    );
    await waitFor(() =>
      expect(t.container.querySelectorAll('img.embed-image__img')).toHaveLength(2),
    );
    const [relative, fromRoot] = [...t.container.querySelectorAll('img.embed-image__img')];
    expect(relative).toHaveAttribute('alt', 'sơ đồ lớp');
    expect(fromRoot).toHaveAttribute('alt', 'sơ đồ.png');
    expect(fileRequests(mock)).toEqual([
      '1 Projects/hình/ảnh tương đối.png',
      'Attachments/2026-10/sơ đồ.png',
    ]);
  });

  it('Enter on a selected Markdown image opens its file', () => {
    const t = renderEditor('![sơ đồ](hình/ảnh%20tương%20đối.png)\n');
    act(() => {
      t.editor.view.dispatch(
        t.editor.state.tr.setSelection(NodeSelection.create(t.editor.state.doc, 1)),
      );
    });
    act(() => void pressKey(t.editor, 'Enter'));
    expect(opened).toHaveBeenCalledWith('1 Projects/hình/ảnh tương đối.png', { newTab: false });
  });

  it('rendering and refreshing images never changes the document (P1)', async () => {
    const t = renderEditor('![[sơ đồ.png]]\n\n![x](hình/ảnh%20tương%20đối.png)\n');
    await waitFor(() =>
      expect(t.container.querySelectorAll('img.embed-image__img')).toHaveLength(2),
    );
    const img = t.container.querySelector('.wikilink img.embed-image__img')!;
    emitServerEvent({
      type: 'note:changed',
      path: 'Attachments/2026-10/sơ đồ.png',
      revision: 'r9',
    });
    // The same element gets the new version; the note itself is not re-rendered.
    await waitFor(() => expect(img).toHaveAttribute('src', 'blob:test/3'));
    expect(t.container.querySelector('.wikilink img.embed-image__img')).toBe(img);
    expect(urls.revoked).toEqual(['blob:test/1']);
    expect(t.onDocChange).not.toHaveBeenCalled();
  });

  it('shows an image as soon as its file appears', async () => {
    const t = renderEditor('![[mới chụp.png]]\n');
    expect(t.container).toHaveTextContent('Không tìm thấy ảnh mới chụp.png');
    mock.on('GET /api/files', { body: {} });
    act(() => setTargets([...FILES, 'Attachments/2026-10/mới chụp.png']));
    await waitFor(() =>
      expect(t.container.querySelector('img.embed-image__img')).toHaveAttribute(
        'src',
        'blob:test/1',
      ),
    );
    expect(t.onDocChange).not.toHaveBeenCalled();
  });

  it('embeds other files as a card whose "Mở" opens the file', () => {
    const t = renderEditor('![[bài giảng 3.pdf]] ![[không có.pdf]]\n');
    const [card, missing] = [...t.container.querySelectorAll('.file-card')];
    expect(card).toHaveTextContent('bài giảng 3.pdfPDFMở');
    fireEvent.click(card!.querySelector('button')!);
    expect(opened).toHaveBeenCalledWith('3 Resources/papers/bài giảng 3.pdf', { newTab: false });
    expect(missing).toHaveTextContent('Không tìm thấy tệp không có.pdf');
    expect(missing!.querySelector('button')).toBeNull();
    expect(fileRequests(mock)).toEqual([]);
  });

  it('[[x.pdf]] is a resolved link that opens the file; Ctrl+click and middle click open a new tab', () => {
    const t = renderEditor('Đọc [[bài giảng 3.pdf]] trước\n');
    const link = t.container.querySelector<HTMLElement>('.wikilink')!;
    expect(link).toHaveAttribute('data-status', 'resolved');
    fireEvent.click(link);
    expect(opened).toHaveBeenLastCalledWith('3 Resources/papers/bài giảng 3.pdf', {
      newTab: false,
    });
    fireEvent.click(link, { ctrlKey: true });
    expect(opened).toHaveBeenLastCalledWith('3 Resources/papers/bài giảng 3.pdf', { newTab: true });
    fireEvent(link, new MouseEvent('auxclick', { button: 1, bubbles: true }));
    expect(opened).toHaveBeenCalledTimes(3);
    act(() => {
      t.editor.view.dispatch(
        t.editor.state.tr.setSelection(NodeSelection.create(t.editor.state.doc, 5)),
      );
    });
    act(() => void pressKey(t.editor, 'Enter'));
    expect(opened).toHaveBeenCalledTimes(4);
  });

  it('an .html link goes to openVaultFile too, nothing is rendered inline', () => {
    const t = renderEditor('[[trang lưu.html]] và ![[trang lưu.html]]\n');
    fireEvent.click(t.container.querySelector('.wikilink')!);
    expect(opened).toHaveBeenCalledWith('3 Resources/other/trang lưu.html', { newTab: false });
    expect(t.container.querySelector('iframe, object, embed')).toBeNull();
    expect(t.container.querySelector('.file-card')).toHaveTextContent('Trang web');
    expect(fileRequests(mock)).toEqual([]);
  });

  it('note links keep opening notes', () => {
    const t = renderEditor('[[Giải tích 1]]\n');
    fireEvent.click(t.container.querySelector('.wikilink')!);
    expect(opened).not.toHaveBeenCalled();
  });
});
