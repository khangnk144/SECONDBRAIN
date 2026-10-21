import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { appRoutes } from '../../app/routes';
import { setApiToken } from '../../lib/api';
import { withQuery } from '../../lib/api/query-string';
import { FILE_ROUTE, fileRoute, noteRoute, type Navigator } from '../../lib/app-navigation';
import { openVaultFile } from '../../lib/open-vault-file';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import {
  fakeDocument,
  fakePdfJs,
  installViewerFakes,
  type FakeDoc,
} from './__tests__/viewer-test-kit';
import { parsePageParam } from './file-viewer-screen';
import { startOpenVaultFile } from './open-vault-file-in-app';
import { loadPdfJs } from './pdf-js';
import { requestedPage, resetPdfViews } from './pdf-view-memory';

vi.mock('./pdf-js', () => ({
  loadPdfJs: vi.fn(),
  documentParameters: (bytes: ArrayBuffer) => ({ data: new Uint8Array(bytes), useWasm: false }),
}));

const PDF = '3 Resources/papers/bài giảng 3.pdf';
const pageUrl = (page: string | number) => withQuery(FILE_ROUTE, { path: PDF, page });

function renderViewer(url: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [url] });
  render(<RouterProvider router={router} />);
  return router;
}

const pageField = () => screen.getByRole('textbox', { name: /^Số trang/ });
const scroller = () => screen.getByRole('region', { name: 'Các trang của bài giảng 3.pdf' });

describe('PDF viewer at a page (F30.1)', () => {
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

  it('`&page=N` opens at page N; an invalid N opens page 1', () => {
    expect(parsePageParam('7')).toBe(7);
    expect(Number.isNaN(parsePageParam('7a'))).toBe(true);
    expect(Number.isNaN(parsePageParam('-2'))).toBe(true);
    expect(requestedPage(7, 12)).toBe(7);
    expect(requestedPage(0, 12)).toBe(1);
    expect(requestedPage(13, 12)).toBe(1);
    expect(requestedPage(Number.NaN, 12)).toBe(1);
  });

  it('opens the viewer at the requested page', async () => {
    renderViewer(pageUrl(7));
    await waitFor(() => expect(pageField()).toHaveValue('7'));
    expect(screen.getByText('/ 12')).toBeInTheDocument();
  });

  it.each(['abc', '0', '99'])('`&page=%s` opens page 1', async (page) => {
    renderViewer(pageUrl(page));
    await waitFor(() => expect(screen.getByText('/ 12')).toBeInTheDocument());
    expect(pageField()).toHaveValue('1');
  });

  it('a new request for the PDF on screen scrolls there, once per navigation', async () => {
    const router = renderViewer(pageUrl(7));
    await waitFor(() => expect(pageField()).toHaveValue('7'));
    await act(() => router.navigate(pageUrl(3)));
    await waitFor(() => expect(pageField()).toHaveValue('3'));
    fireEvent.keyDown(scroller(), { key: 'PageDown' });
    expect(pageField()).toHaveValue('4');
    // The file changes on disk: the reload keeps the reader's page, not the requested one.
    const second = fakeDocument(12);
    pdfjs.getDocument.mockImplementation(() => ({
      promise: Promise.resolve(second),
      destroy: vi.fn(async () => undefined),
    }));
    act(() => emitServerEvent({ type: 'note:changed', path: PDF, revision: 'r2' }));
    await waitFor(() => expect(second.getPage).toHaveBeenCalled());
    await waitFor(() => expect(pageField()).toHaveValue('4'));
    // The same hit chosen again is a new navigation: back to page 3.
    await act(() => router.navigate(pageUrl(3)));
    await waitFor(() => expect(pageField()).toHaveValue('3'));
    expect(mock.callsTo('GET /api/files')).toHaveLength(2);
  });
});

describe('openVaultFile with a page (F30.1)', () => {
  let navigate: Mock<Navigator>;
  let stop: () => void;

  beforeEach(async () => {
    navigate = (await resetAppState('vault-a')) as Mock<Navigator>;
    stop = startOpenVaultFile();
  });
  afterEach(() => stop());

  it('opens the PDF tab, then puts `&page=N` on the same history entry', () => {
    openVaultFile(PDF, { page: 5 });
    expect(navigate.mock.calls).toEqual([
      [fileRoute(PDF), undefined],
      [pageUrl(5), { replace: true }],
    ]);
  });

  it('without a page (or for a note) nothing changes', () => {
    openVaultFile(PDF);
    openVaultFile('2 Areas/Giải tích 1.md', { page: 3 });
    expect(navigate.mock.calls.map((call) => call[0])).toEqual([
      fileRoute(PDF),
      noteRoute('2 Areas/Giải tích 1.md'),
    ]);
  });
});
