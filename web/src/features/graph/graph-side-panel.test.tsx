import { render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Navigator } from '../../lib/app-navigation';
import { noteRoute } from '../../lib/app-navigation';
import { installFetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { GraphScreen } from './graph-screen';
import { GraphView } from './graph-view';
import { installCanvasMock, VAULT, vaultGraph } from './__tests__/graph-test-helpers';

function renderScreen() {
  const router = createMemoryRouter([{ path: '/graph', element: <GraphScreen /> }], {
    initialEntries: ['/graph'],
  });
  render(<RouterProvider router={router} />);
}

/** Presses Tab until `target` has focus (fails after 20 presses). */
async function tabTo(user: UserEvent, target: HTMLElement) {
  for (let i = 0; i < 20 && document.activeElement !== target; i++) await user.tab();
  expect(target).toHaveFocus();
}

describe('brain map side panel: keyboard only (F16.4)', () => {
  let navigate: ReturnType<typeof vi.fn<Navigator>>;

  beforeEach(async () => {
    navigate = (await resetAppState()) as ReturnType<typeof vi.fn<Navigator>>;
    installCanvasMock();
    installFetchMock().on('GET /api/graph', { body: vaultGraph() });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('finds a node, reads its neighbours, walks to one and opens it without the canvas', async () => {
    const select = vi.spyOn(GraphView.prototype, 'setSelection');
    const user = userEvent.setup();
    renderScreen();
    const search = await screen.findByRole('combobox', { name: 'Tìm ghi chú' });
    await screen.findByRole('group', { name: 'Chú thích' });
    expect(document.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');

    await tabTo(user, search);
    await user.keyboard('giai tich');
    expect(screen.getByText('2 ghi chú khớp')).toBeInTheDocument();
    const options = within(screen.getByRole('listbox', { name: 'Ghi chú khớp' })).getAllByRole(
      'option',
    );
    // Titles starting with the query first ("Giải tích 1"), diacritics ignored.
    expect(options.map((o) => o.querySelector('.graph-results__title')?.textContent)).toEqual([
      'Giải tích 1',
      'Đồ án Giải tích',
    ]);
    // Title and folder are read as two parts, not run together ("Giải tích 1 2 Areas").
    expect(options[0]).toHaveAccessibleName('Giải tích 1, trong 2 Areas');
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');

    const details = screen.getByRole('region', { name: 'Giải tích 1' });
    expect(within(details).getByText('Thư mục: 2 Areas')).toBeInTheDocument();
    // The heading carries the count once ("Ghi chú kề (3)", not "Ghi chú kề 3 ghi chú kề").
    expect(
      within(details).getByRole('heading', { level: 3, name: 'Ghi chú kề (3)' }),
    ).toBeVisible();
    const neighbours = within(details).getAllByRole('button', { name: /2026-10-17|Đồ án|Newton/ });
    const expected = ['2026-10-17', 'Newton 1687.pdf', 'Đồ án Giải tích'];
    expect(neighbours.map((b) => b.querySelector('.graph-neighbors__title')?.textContent)).toEqual(
      expected.sort((a, b) => a.localeCompare(b)),
    );
    expect(neighbours.map((b) => b.getAttribute('aria-label'))).toContain(
      'Đồ án Giải tích, trong 1 Projects',
    );
    expect(screen.getByText('Đã chọn Giải tích 1, 3 ghi chú kề.')).toBeInTheDocument();
    expect(select).toHaveBeenLastCalledWith(VAULT.hub, 1);

    // Walk to a neighbour: it becomes the selection and keeps the keyboard place.
    const project = within(details).getByRole('button', { name: /Đồ án Giải tích/ });
    await tabTo(user, project);
    await user.keyboard('{Enter}');
    const projectHeading = screen.getByRole('heading', { level: 2, name: 'Đồ án Giải tích' });
    expect(projectHeading).toHaveFocus();
    expect(select).toHaveBeenLastCalledWith(VAULT.project, 1);
    const projectDetails = screen.getByRole('region', { name: 'Đồ án Giải tích' });
    expect(within(projectDetails).getByRole('heading', { name: 'Ghi chú kề (2)' })).toBeVisible();

    // Second level, as a second click would.
    const levelTwo = within(projectDetails).getByRole('checkbox', { name: 'Hiện thêm cấp 2' });
    await tabTo(user, levelTwo);
    await user.keyboard(' ');
    expect(select).toHaveBeenLastCalledWith(VAULT.project, 2);
    expect(within(projectDetails).getByRole('heading', { name: /^Cấp 2 \(\d+\)$/ })).toBeVisible();

    const open = within(projectDetails).getByRole('button', { name: 'Mở ghi chú' });
    await tabTo(user, open);
    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenLastCalledWith(noteRoute(VAULT.project), undefined);
  });

  it('says so when nothing matches and clears with Escape', async () => {
    const user = userEvent.setup();
    renderScreen();
    const search = await screen.findByRole('combobox', { name: 'Tìm ghi chú' });
    await screen.findByRole('group', { name: 'Chú thích' });
    await user.click(search);
    await user.keyboard('ma trận');
    expect(screen.getByText('Không có ghi chú nào tên "ma trận".')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(search).toHaveValue('');
  });
});
