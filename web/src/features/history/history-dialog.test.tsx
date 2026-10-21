import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryCommit } from '../../lib/api/history-types';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { i18n } from '../../i18n';
import { treeMenuItems } from '../sidebar/tree-menu-items';
import { HistorySection } from './history-section';
import { useHistoryDialog } from './history-dialog-store';
import { openHistoryDialog, resetHistoryDialog } from './open-history-dialog';

const PATH = '1 Projects/Đồ án Giải tích.md';
const CURRENT = '# Đồ án\n\nDòng mới\nChung\n';

function commit(n: number, date: string, message: string, extra: Partial<HistoryCommit> = {}) {
  const hash = String(n).repeat(40).slice(0, 40);
  return {
    commit: hash,
    shortCommit: hash.slice(0, 7),
    date,
    message,
    auto: message.startsWith('auto: '),
    pathAtCommit: PATH,
    ...extra,
  } satisfies HistoryCommit;
}

const COMMITS = [
  commit(3, '2026-10-21T14:40:00+07:00', `restore: ${PATH} @ 2222222`),
  commit(2, '2026-10-21T14:20:00+07:00', 'auto: 2 files'),
  commit(1, '2026-10-20T09:05:00+07:00', 'Nhập từ máy cũ', {
    pathAtCommit: '0 Inbox/Đồ án.md',
  }),
];
const VERSIONS: Record<string, string> = {
  [COMMITS[0]!.commit]: CURRENT,
  [COMMITS[1]!.commit]: '# Đồ án\n\nDòng cũ\nChung\n',
  [COMMITS[2]!.commit]: '# Đồ án\n',
};
const time = (iso: string) => dayjs(iso).format('HH:mm, DD/MM/YYYY');

async function openDialog(commitHash: string | null = null) {
  await act(async () => openHistoryDialog(PATH, commitHash));
  return screen.findByRole('dialog', { name: 'Lịch sử phiên bản' });
}

describe('version history (F20.3)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState('vault-a');
    mock = installFetchMock();
    mock.on('GET /api/history', { body: { available: true, commits: COMMITS } });
    mock.on('GET /api/history/status', { body: { available: true, lastCommitAt: null } });
    mock.on('GET /api/note', { body: { path: PATH, content: CURRENT, revision: 'rev-now' } });
    mock.on('GET /api/history/version', (call) => ({
      body: { content: VERSIONS[call.query.get('commit') ?? ''], pathAtCommit: PATH },
    }));
    mock.on('POST /api/history/restore', { body: { revision: 'rev-new', commit: 'abc' } });
  });
  afterEach(() => {
    act(() => resetHistoryDialog());
    vi.unstubAllGlobals();
  });

  it('lists the versions newest first with readable labels', async () => {
    const dialog = await openDialog();
    const list = await within(dialog).findByRole('list', { name: 'Các phiên bản, mới nhất trước' });
    const items = within(list).getAllByRole('button');
    expect(items.map((item) => item.textContent)).toEqual([
      `Khôi phục từ bản lúc ${time(COMMITS[1]!.date)}${time(COMMITS[0]!.date)}`,
      `Tự động lưu lúc ${time(COMMITS[1]!.date)}`,
      `Nhập từ máy cũ${time(COMMITS[2]!.date)}Khi đó tên là Đồ án`,
    ]);
    expect(items[0]).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(items[0]).toHaveFocus());
    // The newest version equals the note: nothing to restore.
    expect(await within(dialog).findByText('Bản này giống hệt bản hiện tại.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Khôi phục phiên bản này' })).toBeDisabled();
  });

  it('shows what a restore would change, then restores at the current revision', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog();
    const list = await within(dialog).findByRole('list', { name: /mới nhất trước/ });
    await waitFor(() => expect(within(list).getAllByRole('button')[0]).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(within(list).getAllByRole('button')[1]).toHaveAttribute('aria-current', 'true');
    expect(
      await within(dialog).findByText('Nếu khôi phục: 1 dòng trở lại (+), 1 dòng mất đi (−).'),
    ).toBeInTheDocument();
    const rows = within(dialog).getByRole('list', { name: /Khác biệt/ });
    expect(rows).toHaveTextContent('Dòng cũ');
    expect(rows).toHaveTextContent('Dòng mới');
    expect(mock.callsTo('GET /api/history/version').at(-1)?.query.get('commit')).toBe(
      COMMITS[1]!.commit,
    );

    await user.click(within(dialog).getByRole('button', { name: 'Khôi phục phiên bản này' }));
    const confirm = within(dialog).getByRole('button', { name: 'Khôi phục' });
    expect(confirm).toHaveFocus();
    await user.click(confirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.callsTo('POST /api/history/restore')[0]?.body).toEqual({
      path: PATH,
      commit: COMMITS[1]!.commit,
      expectedRevision: 'rev-now',
    });
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Đã khôi phục phiên bản cũ của Đồ án Giải tích.',
    );
    expect(useHistoryDialog.getState().restores).toBe(1);
  });

  it('a note changed meanwhile: says so and reloads the list (409)', async () => {
    const user = userEvent.setup();
    mock.on('POST /api/history/restore', apiError(409, 'CONFLICT', { currentRevision: 'rev-2' }));
    const dialog = await openDialog(COMMITS[2]!.commit);
    await user.click(
      await within(dialog).findByRole('button', { name: 'Khôi phục phiên bản này' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Khôi phục' }));
    expect(
      await within(dialog).findByText('Ghi chú vừa thay đổi. Mở lại lịch sử để xem bản mới nhất.'),
    ).toBeInTheDocument();
    expect(mock.callsTo('GET /api/history')).toHaveLength(2);
    expect(mock.callsTo('GET /api/note')).toHaveLength(2);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens from "Lịch sử phiên bản" in the note menu of the sidebar tree', async () => {
    const row = {
      kind: 'note' as const,
      id: `n:${PATH}`,
      path: PATH,
      title: 'Đồ án Giải tích',
      level: 1,
      setSize: 1,
      posInSet: 1,
      parentId: 'f:1 Projects',
    };
    const entry = treeMenuItems(row, i18n.t, () => undefined).find((item) => item.id === 'history');
    expect(entry?.label).toBe('Lịch sử phiên bản');
    act(() => entry?.onSelect());
    const dialog = await screen.findByRole('dialog', { name: 'Lịch sử phiên bản' });
    expect(within(dialog).getByText('Đồ án Giải tích')).toBeInTheDocument();
    expect(mock.callsTo('GET /api/history')[0]?.query.get('path')).toBe(PATH);
  });

  it('without git, history only says how to turn it on', async () => {
    mock.on('GET /api/history', { body: { available: false, commits: [] } });
    mock.on('GET /api/history/status', {
      body: { available: false, reason: 'git-missing', lastCommitAt: null },
    });
    const dialog = await openDialog();
    expect(
      await within(dialog).findByText('Lịch sử cần Git. Cài Git for Windows để bật.'),
    ).toBeInTheDocument();
    expect(mock.callsTo('GET /api/history/version')).toHaveLength(0);
    expect(within(dialog).queryByRole('button', { name: /Khôi phục/ })).toBeNull();
  });

  it('the right pane lists the 5 newest versions and opens the dialog on one of them', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 7 }, (_, i) =>
      commit(i + 1, `2026-10-2${i % 2}T0${i}:00:00+07:00`, `auto: ${i + 1} files`),
    );
    mock.on('GET /api/history', { body: { available: true, commits: many } });
    render(<HistorySection path={PATH} />);
    expect(mock.callsTo('GET /api/history')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Lịch sử' }));
    const buttons = await screen.findAllByRole('button', { name: /^Tự động lưu lúc/ });
    expect(buttons).toHaveLength(5);
    await user.click(buttons[2]!);
    const dialog = await screen.findByRole('dialog', { name: 'Lịch sử phiên bản' });
    const items = await within(dialog).findAllByRole('button', { name: /^Tự động lưu lúc/ });
    expect(items[2]).toHaveAttribute('aria-current', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Xem tất cả' })).toBeInTheDocument();
  });

  it('the right pane says when git is missing', async () => {
    const user = userEvent.setup();
    mock.on('GET /api/history', { body: { available: false, commits: [] } });
    mock.on('GET /api/history/status', {
      body: { available: false, reason: 'git-missing', lastCommitAt: null },
    });
    render(<HistorySection path={PATH} />);
    await user.click(screen.getByRole('button', { name: 'Lịch sử' }));
    expect(
      await screen.findByText('Lịch sử cần Git. Cài Git for Windows để bật.'),
    ).toBeInTheDocument();
  });
});
