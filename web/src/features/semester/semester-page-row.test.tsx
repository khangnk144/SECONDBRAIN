import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import type { Navigator } from '../../lib/app-navigation';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { DialogHost } from '../dialogs/dialog-host';
import { SemesterPageRow } from '../settings/semester-page-row';
import type { SemesterPageStatus } from './semester-api';
import { resetSemesterPageStore } from './semester-page-store';

const PAGE = 'Học kỳ này.md';
const status = (patch: Partial<SemesterPageStatus> = {}): SemesterPageStatus => ({
  available: true,
  enabled: false,
  path: PAGE,
  state: 'off',
  exists: false,
  edited: false,
  ours: false,
  lastGeneratedAt: null,
  ...patch,
});
const ON = status({
  enabled: true,
  state: 'ok',
  exists: true,
  ours: true,
  lastGeneratedAt: new Date(2026, 2, 2, 14, 5).toISOString(),
});

let mock: FetchMock;
let navigate: ReturnType<typeof vi.fn<Navigator>>;

function renderRow(search = '') {
  const router = createMemoryRouter(
    [
      {
        path: '/settings',
        element: (
          <>
            <SemesterPageRow />
            <DialogHost />
          </>
        ),
      },
    ],
    { initialEntries: [`/settings${search}`] },
  );
  return render(<RouterProvider router={router} />);
}

const switchControl = () => screen.findByRole('switch', { name: 'Trang Học kỳ này' });

beforeEach(async () => {
  navigate = (await resetAppState('vault-a')) as ReturnType<typeof vi.fn<Navigator>>;
  resetSemesterPageStore();
  mock = installFetchMock();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Settings → Kho ghi chú → "Trang Học kỳ này" (F25.1–F25.3)', () => {
  it('(F25.1) is off by default; turning it on says where the page is and keeps it current', async () => {
    mock.on('GET /api/semester-page', { body: status() });
    mock.on('POST /api/semester-page', { body: { status: ON } });
    renderRow();
    const toggle = await switchControl();
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/liệt kê các môn học và đồ án đang làm/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mở trang' })).toBeNull();

    fireEvent.click(toggle);
    await screen.findByText('Đã bật. Trang Học kỳ này nằm ở gốc kho ghi chú.');
    expect(mock.callsTo('POST /api/semester-page')[0]?.body).toEqual({ action: 'enable' });
    expect(toggle).toBeChecked();
    expect(
      screen.getByText('App đang tự cập nhật trang Học kỳ này. Lần cuối: 14:05, 2/3/2026.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mở trang' }));
    expect(navigate).toHaveBeenLastCalledWith(`/note?path=${encodeURIComponent(PAGE)}`, undefined);
  });

  it('(F25.1) a note of hers kept the name: the message names the page it made instead', async () => {
    mock.on('GET /api/semester-page', { body: status() });
    mock.on('POST /api/semester-page', { body: { status: { ...ON, path: 'Học kỳ này 2.md' } } });
    renderRow();
    fireEvent.click(await switchControl());
    await screen.findByText('Đã bật. Trang Học kỳ này 2 nằm ở gốc kho ghi chú.');
    expect(
      screen.getByText(/App đang tự cập nhật trang Học kỳ này 2\. Lần cuối/),
    ).toBeInTheDocument();
  });

  it('(F25.3) an edited page: the notice and "Tạo lại", which asks first', async () => {
    mock.on('GET /api/semester-page', {
      body: status({ enabled: true, state: 'edited', edited: true, exists: true }),
    });
    mock.on('POST /api/semester-page', { body: { status: ON } });
    renderRow();
    await screen.findByText(/đã được sửa bên ngoài app, nên app không ghi đè nữa/);
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lại' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tạo lại trang Học kỳ này?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Giữ nguyên' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.callsTo('POST /api/semester-page')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Tạo lại' }));
    const again = await screen.findByRole('dialog', { name: 'Tạo lại trang Học kỳ này?' });
    fireEvent.click(within(again).getByRole('button', { name: 'Tạo lại' }));
    await screen.findByText('Đã tạo lại trang Học kỳ này.');
    expect(mock.callsTo('POST /api/semester-page')[0]?.body).toEqual({ action: 'regenerate' });
    expect(screen.queryByRole('button', { name: 'Tạo lại' })).toBeNull();
  });

  it('(F25.3) a deleted page offers "Tạo lại" without asking', async () => {
    mock.on('GET /api/semester-page', { body: status({ enabled: true, state: 'missing' }) });
    mock.on('POST /api/semester-page', { body: { status: ON } });
    renderRow();
    await screen.findByText('Trang Học kỳ này đã bị xóa. Bấm Tạo lại nếu bạn muốn có lại trang.');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lại' }));
    await screen.findByText('Đã tạo lại trang Học kỳ này.');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('(F25.3) off with the page still there: "Chuyển trang vào thùng rác" with an undo toast', async () => {
    mock.on('GET /api/semester-page', { body: status({ exists: true, ours: true }) });
    mock.on('POST /api/semester-page', {
      body: { status: status(), journalId: '01JOURNALAAAAAAAAAAAAAAAAA' },
    });
    renderRow();
    await screen.findByText('Trang Học kỳ này vẫn còn trong kho như một ghi chú thường.');
    fireEvent.click(screen.getByRole('button', { name: 'Chuyển trang vào thùng rác' }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(
        'Đã chuyển trang Học kỳ này vào thùng rác.',
      ),
    );
    expect(mock.callsTo('POST /api/semester-page')[0]?.body).toEqual({ action: 'trash' });
    expect(useToastStore.getState().toasts[0]?.action?.label).toBe('Hoàn tác');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Chuyển trang vào thùng rác' })).toBeNull(),
    );
  });

  it('turning it off says the file stays; a failure says so and the switch goes back', async () => {
    mock.on('GET /api/semester-page', { body: ON });
    mock.on('POST /api/semester-page', {
      status: 503,
      body: { error: { code: 'UNAVAILABLE', message: 'x' } },
    });
    renderRow();
    const toggle = await switchControl();
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await screen.findByRole('alert');
    expect(toggle).toBeChecked();
  });

  it('`?focus=semester-page` brings the switch into view; nothing shows without the service', async () => {
    mock.on('GET /api/semester-page', { body: status() });
    const { unmount } = renderRow('?focus=semester-page');
    const toggle = await switchControl();
    await waitFor(() => expect(toggle).toHaveFocus());
    unmount();
    resetSemesterPageStore();
    mock.on('GET /api/semester-page', { body: status({ available: false }) });
    const { container } = renderRow();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('has English labels', async () => {
    await i18n.changeLanguage('en');
    mock.on('GET /api/semester-page', { body: { ...ON, path: 'This semester.md' } });
    renderRow();
    expect(await screen.findByRole('switch', { name: 'This semester page' })).toBeChecked();
    expect(screen.getByText(/The app keeps This semester up to date/)).toBeInTheDocument();
  });
});
