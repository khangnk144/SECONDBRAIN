import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSummary } from '../../lib/api/deadlines-types';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useTabsStore } from '../../lib/tabs-store';
import { useToastStore } from '../../lib/toast-store';
import { useVaultStore } from '../../lib/vault-store';
import { MAX_PROJECT_CARDS, ProjectsSection } from './projects-section';
import { NOTE, project } from './today-test-fixtures';

function renderSection(projects: ProjectSummary[], onMarkedDone = vi.fn()) {
  const utils = render(
    <ProjectsSection projects={projects} onMarkedDone={onMarkedDone} refresh={vi.fn()} />,
  );
  return { ...utils, onMarkedDone };
}

describe('"Đồ án đang làm" (F10.5)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('progress is done/total of the project note; no tasks shows "chưa có việc"', () => {
    const empty = project({
      path: '1 Projects/Web bán hàng.md',
      title: 'Web bán hàng',
      progress: null,
      daysLeft: -2,
      urgency: 'urgent',
    });
    renderSection([project(), empty]);
    const bar = screen.getByRole('progressbar', { name: 'Tiến độ Đồ án Giải tích' });
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemax', '5');
    expect(bar).toHaveAttribute('aria-valuetext', '3/5 việc');
    // "60%" on screen (the mock); "3/5 việc" is the value text and the tooltip.
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(bar.parentElement).toHaveAttribute('title', '3/5 việc');
    expect(screen.getByText('còn 18 ngày')).toHaveClass('project-card__due--ok');
    expect(screen.getByText('quá hạn 2 ngày')).toHaveClass('project-card__due--urgent');
    expect(screen.getByText('chưa có việc')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  });

  it('the title opens the note', async () => {
    const user = userEvent.setup();
    renderSection([project()]);
    await user.click(screen.getByRole('button', { name: 'Đồ án Giải tích' }));
    expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual([NOTE]);
  });

  it('every task done: "Đánh dấu xong" sets status done; "Để sau" is remembered per vault', async () => {
    const user = userEvent.setup();
    mock.on('PATCH /api/note/frontmatter', { body: { revision: 'r2', content: '' } });
    const finished = project({ progress: { done: 5, total: 5 } });
    const { onMarkedDone, unmount } = renderSection([finished]);
    const card = screen.getByRole('listitem');
    expect(within(card).getByText('Xong hết việc rồi. Đánh dấu dự án xong?')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Đánh dấu xong' }));
    await waitFor(() => expect(onMarkedDone).toHaveBeenCalledWith(NOTE));
    expect(mock.callsTo('PATCH /api/note/frontmatter')[0]?.body).toEqual({
      path: NOTE,
      expectedRevision: 'r1',
      set: { status: 'done' },
    });
    unmount();

    renderSection([finished]);
    await user.click(screen.getByRole('button', { name: 'Để sau' }));
    expect(screen.queryByText(/Đánh dấu dự án xong\?/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Đồ án Giải tích' })).toHaveFocus();
    const again = renderSection([finished]);
    expect(within(again.container).queryByText(/Đánh dấu dự án xong\?/)).toBeNull();
    again.unmount();
    useVaultStore.setState({ vaultId: 'vault-b' });
    const otherVault = renderSection([finished]);
    expect(within(otherVault.container).getByText(/Đánh dấu dự án xong\?/)).toBeInTheDocument();
  });

  it('"Đánh dấu xong" offers "Hoàn tác" for 10 s; undo puts status doing back, revision-checked', async () => {
    const user = userEvent.setup();
    mock.on('PATCH /api/note/frontmatter', (call) => {
      const status = (call.body as { set: { status: string } }).set.status;
      return { body: { revision: status === 'done' ? 'r2' : 'r3', content: '' } };
    });
    renderSection([project({ progress: { done: 5, total: 5 } })]);
    await user.click(screen.getByRole('button', { name: 'Đánh dấu xong' }));
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const toast = useToastStore.getState().toasts[0]!;
    expect(toast.message).toBe('Đã đánh dấu “Đồ án Giải tích” xong.');
    expect(toast.action?.label).toBe('Hoàn tác');
    expect(toast.durationMs).toBe(10_000);

    await toast.action!.run();
    // The undo carries the revision our own write left, so a note changed elsewhere is refused.
    expect(mock.callsTo('PATCH /api/note/frontmatter').map((c) => c.body)).toEqual([
      { path: NOTE, expectedRevision: 'r1', set: { status: 'done' } },
      { path: NOTE, expectedRevision: 'r2', set: { status: 'doing' } },
    ]);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('Đã hoàn tác.');
  });

  it('shows six projects, then "Xem thêm n đồ án" reveals the rest in place and focuses the first', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 8 }, (_, i) =>
      project({ path: `1 Projects/Đồ án ${i + 1}.md`, title: `Đồ án ${i + 1}` }),
    );
    renderSection(many);
    expect(screen.getAllByRole('listitem')).toHaveLength(MAX_PROJECT_CARDS);
    await user.click(screen.getByRole('button', { name: 'Xem thêm 2 đồ án' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(screen.queryByRole('button', { name: /^Xem thêm/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Đồ án 7' })).toHaveFocus();
  });

  it('empty: invites creating one from the "Course project" template', async () => {
    const user = userEvent.setup();
    mock.on('POST /api/note', {
      status: 201,
      body: { path: '1 Projects/Đồ án mới.md', revision: 'r1', cursor: 120 },
    });
    renderSection([]);
    expect(screen.getByText('Chưa có đồ án nào. Tạo một cái từ mẫu Đồ án?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() =>
      expect(mock.callsTo('POST /api/note')[0]?.body).toEqual({
        path: '1 Projects/Đồ án mới.md',
        unique: true,
        template: 'Templates/Course project.md',
      }),
    );
    expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual([
      '1 Projects/Đồ án mới.md',
    ]);
  });
});
