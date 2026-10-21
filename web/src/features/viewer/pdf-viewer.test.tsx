import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appRoutes } from '../../app/routes';
import { setApiToken } from '../../lib/api';
import { useTabsStore } from '../../lib/tabs-store';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import {
  fakeDocument,
  fakePdfJs,
  FakeIntersectionObserver,
  FakeTextLayer,
  installViewerFakes,
  pdfError,
  type FakeDoc,
} from './__tests__/viewer-test-kit';
import { loadPdfJs } from './pdf-js';
import { resetPdfViews } from './pdf-view-memory';

vi.mock('./pdf-js', () => ({
  loadPdfJs: vi.fn(),
  documentParameters: (bytes: ArrayBuffer) => ({ data: new Uint8Array(bytes), useWasm: false }),
}));

const PDF = '3 Resources/papers/bài giảng 3.pdf';

function renderViewer(path = PDF) {
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [`/file?path=${encodeURIComponent(path)}`],
  });
  render(<RouterProvider router={router} />);
  return router;
}

const pageField = () => screen.getByRole('textbox', { name: /^Số trang/ });
const scroller = () => screen.getByRole('region', { name: `Các trang của bài giảng 3.pdf` });

describe('PDF viewer tab (F15.3)', () => {
  let mock: FetchMock;
  let doc: FakeDoc;
  let pdfjs: ReturnType<typeof fakePdfJs>;

  beforeEach(async () => {
    await resetAppState('vault-a');
    resetPdfViews();
    installViewerFakes();
    setApiToken('tok-1');
    mock = installFetchMock();
    mock.on('GET /api/files', { body: { pdf: 'bytes' } });
    mock.on('GET /api/resources', { body: { files: [] } });
    doc = fakeDocument(12);
    pdfjs = fakePdfJs(async () => doc);
    vi.mocked(loadPdfJs).mockResolvedValue(pdfjs as never);
  });
  afterEach(() => {
    setApiToken(null);
    vi.unstubAllGlobals();
  });

  it('opens the PDF from bytes fetched with the token header, in a file tab', async () => {
    renderViewer();
    await waitFor(() => expect(pageField()).toHaveValue('1'));
    const call = mock.callsTo('GET /api/files')[0];
    expect(call?.query.get('path')).toBe(PDF);
    expect(call?.url).not.toContain('tok-1');
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-SB-Token']).toBe('tok-1');
    const params = pdfjs.getDocument.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.data).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(params.data as Uint8Array)).toBe('{"pdf":"bytes"}');
    expect(params.url).toBeUndefined();
    expect(screen.getByRole('heading', { level: 1, name: 'bài giảng 3.pdf' })).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Thẻ ghi chú đang mở' });
    expect(within(tabs).getByRole('button', { name: 'bài giảng 3.pdf' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(useTabsStore.getState().tabs[0]?.kind).toBe('file');
    expect(screen.getByText('/ 12')).toBeInTheDocument();
  });

  it('draws only the visible pages and their neighbours, with a text layer', async () => {
    renderViewer();
    await waitFor(() => expect(FakeIntersectionObserver.current).not.toBeNull());
    FakeIntersectionObserver.show([6]);
    await waitFor(() => expect(screen.getByText('Trang 7')).toBeInTheDocument());
    // First the opening pages (1 and 2), then 6 with its neighbours; nothing else is fetched.
    const drawn = doc.getPage.mock.calls.map((call) => call[0] as number);
    expect([...new Set(drawn)].sort((a, b) => a - b)).toEqual([1, 2, 5, 6, 7]);
    expect(FakeTextLayer.instances.length).toBeGreaterThanOrEqual(3);
    const withCanvas = [...document.querySelectorAll<HTMLElement>('.pdf-page')]
      .filter((frame) => frame.querySelector('canvas'))
      .map((frame) => frame.dataset.page);
    expect(withCanvas).toEqual(['5', '6', '7']);
    expect(document.querySelectorAll('.pdf-page')).toHaveLength(12);
  });

  it('moves between pages with the buttons, the page field and PageUp/PageDown/Home/End', async () => {
    const user = userEvent.setup();
    renderViewer();
    await waitFor(() => expect(pageField()).toHaveValue('1'));
    await user.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(pageField()).toHaveValue('2');
    fireEvent.keyDown(scroller(), { key: 'PageDown' });
    expect(pageField()).toHaveValue('3');
    fireEvent.keyDown(scroller(), { key: 'End' });
    expect(pageField()).toHaveValue('12');
    expect(screen.getByRole('button', { name: 'Trang sau' })).toBeDisabled();
    fireEvent.keyDown(scroller(), { key: 'Home' });
    expect(pageField()).toHaveValue('1');
    await user.clear(pageField());
    await user.type(pageField(), '7{Enter}');
    expect(pageField()).toHaveValue('7');
    fireEvent.keyDown(scroller(), { key: 'PageUp' });
    expect(pageField()).toHaveValue('6');
    await user.clear(pageField());
    await user.type(pageField(), '99{Enter}');
    expect(pageField()).toHaveValue('6');
    // Outside the viewer the keys are left to the browser.
    expect(fireEvent.keyDown(document.body, { key: 'PageDown' })).toBe(true);
  });

  it('zooms with the buttons and Ctrl+= / Ctrl+- / Ctrl+0, and fits the width', async () => {
    const user = userEvent.setup();
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1100);
    renderViewer();
    // 600 pt page = 800 px at 100 %; (1100 - 2 × 16) / 800 = 133.5 %.
    await waitFor(() => expect(screen.getByText('134%')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Vừa chiều rộng' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Phóng to' }));
    expect(screen.getByText('150%')).toBeInTheDocument();
    const frame = document.querySelector<HTMLElement>('.pdf-page[data-page="1"]');
    expect(frame?.style.width).toBe('1200px');
    expect(screen.getByRole('button', { name: 'Vừa chiều rộng' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.keyDown(scroller(), { key: '=', ctrlKey: true });
    expect(screen.getByText('175%')).toBeInTheDocument();
    const event = fireEvent.keyDown(scroller(), { key: '-', ctrlKey: true });
    expect(event).toBe(false);
    expect(screen.getByText('150%')).toBeInTheDocument();
    fireEvent.keyDown(scroller(), { key: '0', ctrlKey: true });
    expect(screen.getByText('100%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Thu nhỏ' }));
    expect(screen.getByText('90%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Vừa chiều rộng' }));
    expect(screen.getByText('134%')).toBeInTheDocument();
    width.mockRestore();
  });

  it('a missing file says so and closes its tab', async () => {
    const user = userEvent.setup();
    mock.on('GET /api/files', apiError(404, 'NOT_FOUND'));
    const router = renderViewer();
    expect(
      await screen.findByText(
        'Không tìm thấy tệp bài giảng 3.pdf. Có thể nó đã được đổi tên hoặc chuyển vào thùng rác.',
      ),
    ).toBeInTheDocument();
    expect(pdfjs.getDocument).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Đóng thẻ' }));
    expect(useTabsStore.getState().tabs).toEqual([]);
    expect(router.state.location.pathname).toBe('/');
  });

  it('a broken or password-protected PDF offers the download instead', async () => {
    pdfjs = fakePdfJs(() => Promise.reject(pdfError('InvalidPDFException')));
    vi.mocked(loadPdfJs).mockResolvedValue(pdfjs as never);
    renderViewer();
    expect(
      await screen.findByText(/^Không mở được bài giảng 3.pdf: tệp không phải PDF hợp lệ/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tải về' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mở bằng ứng dụng khác' })).toBeInTheDocument();

    pdfjs = fakePdfJs(() => Promise.reject(pdfError('PasswordException')));
    vi.mocked(loadPdfJs).mockResolvedValue(pdfjs as never);
    act(() => emitServerEvent({ type: 'note:changed', path: PDF, revision: 'r2' }));
    expect(await screen.findByText(/được đặt mật khẩu/)).toBeInTheDocument();
  });

  it('reloads in place when the file changes, keeping the page; deleted → missing', async () => {
    renderViewer();
    await waitFor(() => expect(pageField()).toHaveValue('1'));
    fireEvent.keyDown(scroller(), { key: 'End' });
    fireEvent.keyDown(scroller(), { key: 'PageUp' });
    expect(pageField()).toHaveValue('11');
    const second = fakeDocument(12);
    pdfjs.getDocument.mockImplementation(() => ({
      promise: Promise.resolve(second),
      destroy: vi.fn(async () => undefined),
    }));
    act(() => emitServerEvent({ type: 'note:changed', path: PDF, revision: 'r2' }));
    await waitFor(() => expect(second.getPage).toHaveBeenCalled());
    expect(mock.callsTo('GET /api/files')).toHaveLength(2);
    await waitFor(() => expect(pageField()).toHaveValue('11'));
    expect(doc.loadingTask.destroy).toHaveBeenCalled();

    act(() => emitServerEvent({ type: 'note:deleted', path: PDF }));
    expect(await screen.findByText(/Không tìm thấy tệp bài giảng 3.pdf/)).toBeInTheDocument();
    // The tab stays so the message can be read.
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it('the right pane lists the notes that mention the document', async () => {
    const user = userEvent.setup();
    mock.on('GET /api/resources', {
      body: {
        files: [
          {
            path: PDF,
            name: 'bài giảng 3.pdf',
            folder: '3 Resources/papers',
            kind: 'pdf',
            size: 2048,
            mtime: 0,
            referencedBy: [{ path: '2 Areas/Giải tích 1.md', title: 'Giải tích 1' }],
          },
        ],
      },
    });
    const router = renderViewer();
    const pane = await screen.findByRole('complementary', { name: 'Ngăn bên phải' });
    expect(within(pane).getByText('Ghi chú nhắc đến tài liệu này')).toBeInTheDocument();
    await user.click(await within(pane).findByRole('button', { name: 'Giải tích 1' }));
    expect(router.state.location.pathname).toBe('/note');
    expect(new URLSearchParams(router.state.location.search).get('path')).toBe(
      '2 Areas/Giải tích 1.md',
    );
  });

  it('never renders other files on the viewer route', async () => {
    renderViewer('1 Projects/Trang web.html');
    expect(await screen.findByText(/Trang web.html không xem được trong app/)).toBeInTheDocument();
    expect(mock.callsTo('GET /api/files')).toHaveLength(0);
    expect(document.querySelector('iframe, object, embed')).toBeNull();
  });
});
