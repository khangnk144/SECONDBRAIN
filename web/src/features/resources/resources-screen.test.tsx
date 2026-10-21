import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ResourceFile } from '../../lib/api/resources-types';
import { fileRoute, noteRoute, type Navigator } from '../../lib/app-navigation';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { startOpenVaultFile } from '../viewer/open-vault-file-in-app';
import { groupResources } from './resource-groups';
import { ResourcesScreen } from './resources-screen';

const MTIME = new Date(2026, 9, 21, 9, 30).getTime();

function file(path: string, kind: ResourceFile['kind'], refs: string[] = []): ResourceFile {
  const slash = path.lastIndexOf('/');
  return {
    path,
    name: path.slice(slash + 1),
    folder: path.slice(0, slash),
    kind,
    size: 2_516_582,
    mtime: MTIME,
    referencedBy: refs.map((title) => ({ path: `2 Areas/${title}.md`, title })),
  };
}

const FILES: ResourceFile[] = [
  file('3 Resources/Trang gốc.html', 'other'),
  file('3 Resources/other/Ghi chép.md', 'note'),
  file('3 Resources/papers/bài giảng 3.pdf', 'pdf', ['Giải tích 1', 'Đồ án']),
  file('3 Resources/papers/ML/Học máy.pdf', 'pdf'),
  file('3 Resources/slides/Tuần 1.pptx', 'document'),
  file('3 Resources/web/Bài viết.html', 'other'),
  file('Attachments/2026-09/ảnh cũ.png', 'image'),
  file('Attachments/2026-10/sơ đồ.png', 'image'),
];

const headings = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const names = () =>
  [...document.querySelectorAll('.resource-row__name')].map((button) => button.textContent);

describe('documents view "Tài liệu" (F15)', () => {
  let mock: FetchMock;
  let navigate: Mock<Navigator>;
  let stopOpen: () => void;

  beforeEach(async () => {
    navigate = (await resetAppState('vault-a')) as Mock<Navigator>;
    mock = installFetchMock();
    mock.on('GET /api/resources', { body: { files: FILES } });
    mock.on('POST /api/reveal', { status: 204 });
    mock.on('POST /api/files/open-external', { status: 204 });
    stopOpen = startOpenVaultFile();
  });
  afterEach(() => {
    stopOpen();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('groups files by folder: papers, slides, web, other, then attachments newest month first', async () => {
    render(<ResourcesScreen />);
    await screen.findByText('bài giảng 3.pdf');
    expect(headings()).toEqual([
      '3 Resources/papers',
      '3 Resources/slides',
      '3 Resources/web',
      '3 Resources/other',
      '3 Resources',
      'Attachments/2026-10',
      'Attachments/2026-09',
    ]);
    expect(screen.getByText('8 tệp')).toBeInTheDocument();
    const row = screen.getByText('Học máy.pdf').closest('li')!;
    expect(within(row).getByText(/2,4 MB, 21\/10\/2026, ML/)).toBeInTheDocument();
    expect(
      groupResources(FILES, 'hoc may').flatMap((g) => g.files.map((f) => f.file.name)),
    ).toEqual(['Học máy.pdf']);
  });

  it('shows the notes that mention a file, or that none does, and opens them', async () => {
    const user = userEvent.setup();
    render(<ResourcesScreen />);
    const row = (await screen.findByText('bài giảng 3.pdf')).closest('li')!;
    expect(row).toHaveTextContent('Được nhắc trong Giải tích 1, Đồ án');
    const other = screen.getByText('Tuần 1.pptx').closest('li')!;
    expect(other).toHaveTextContent('Chưa ghi chú nào nhắc đến');
    await user.click(within(row).getByRole('button', { name: 'Đồ án' }));
    expect(navigate).toHaveBeenLastCalledWith(noteRoute('2 Areas/Đồ án.md'), undefined);
    await user.click(within(row).getByRole('button', { name: 'bài giảng 3.pdf' }));
    expect(navigate).toHaveBeenLastCalledWith(
      fileRoute('3 Resources/papers/bài giảng 3.pdf'),
      undefined,
    );
  });

  it('filters by name without caring about diacritics', async () => {
    const user = userEvent.setup();
    render(<ResourcesScreen />);
    await screen.findByText('bài giảng 3.pdf');
    await user.type(screen.getByRole('searchbox', { name: 'Lọc tài liệu' }), 'so do');
    expect(names()).toEqual(['sơ đồ.png']);
    expect(screen.getByText('1 trên 8 tệp khớp')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Lọc tài liệu' }));
    await user.type(screen.getByRole('searchbox', { name: 'Lọc tài liệu' }), 'xyz');
    expect(screen.getByText('Không có tệp nào khớp “xyz”.')).toBeInTheDocument();
  });

  it('row menu: download, open with another app, show in folder; arrows move between names', async () => {
    const user = userEvent.setup();
    render(<ResourcesScreen />);
    await screen.findByText('Tuần 1.pptx');
    await user.click(screen.getByRole('button', { name: 'Thao tác với Tuần 1.pptx' }));
    const menu = screen.getByRole('menu', { name: 'Thao tác với Tuần 1.pptx' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Mở', 'Tải về', 'Mở bằng ứng dụng khác', 'Hiện trong thư mục']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Hiện trong thư mục' }));
    await waitFor(() =>
      expect(mock.callsTo('POST /api/reveal')[0]?.body).toEqual({
        path: '3 Resources/slides/Tuần 1.pptx',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Thao tác với Tuần 1.pptx' }));
    await user.click(screen.getByRole('menuitem', { name: 'Mở bằng ứng dụng khác' }));
    await waitFor(() => expect(mock.callsTo('POST /api/files/open-external')).toHaveLength(1));

    const first = screen.getByRole('button', { name: 'bài giảng 3.pdf' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'Học máy.pdf' })).toHaveFocus();
  });

  it('invites to drop a PDF when empty, and refreshes on vault events', async () => {
    mock.on('GET /api/resources', { body: { files: [] } });
    render(<ResourcesScreen />);
    expect(
      await screen.findByText(
        'Chưa có tài liệu nào. Kéo một file PDF vào ghi chú để lưu nó ở đây.',
      ),
    ).toBeInTheDocument();
    mock.on('GET /api/resources', { body: { files: [FILES[2]] } });
    act(() =>
      emitServerEvent({
        type: 'note:created',
        path: '3 Resources/papers/bài giảng 3.pdf',
        revision: 'r',
      }),
    );
    expect(await screen.findByText('bài giảng 3.pdf')).toBeInTheDocument();
  });
});
