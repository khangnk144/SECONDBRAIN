import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import vi_ from '../i18n/vi.json';
import { useCaptureUi } from '../lib/capture-ui-store';
import { withStyle } from '../lib/testing/ui-style-test-kit';
import {
  noteUrl,
  renderShell,
  setupShell,
  stubViewport,
  teardownShell,
} from './__tests__/shell-test-kit';

const nav = () => screen.getByRole('navigation', { name: vi_.nav.label });
const sheet = (name: string) => screen.queryByRole('dialog', { name });

describe('bento between 960 and 1199 px', () => {
  beforeEach(async () => {
    await setupShell();
    withStyle('bento');
    stubViewport(1100);
  });
  afterEach(() => teardownShell());

  it('(F35.2) note routes open the folders as a drawer, so the note keeps its room', async () => {
    const user = userEvent.setup();
    renderShell(noteUrl());
    expect(screen.queryByRole('complementary', { name: 'Thư mục' })).toBeNull();
    expect(screen.getByRole('complementary', { name: vi_.panel.label })).toBeInTheDocument();
    await user.click(within(nav()).getByRole('button', { name: 'Thư mục' }));
    expect(screen.getByRole('dialog', { name: 'Thư mục' })).toBeInTheDocument();
  });
});

describe('bento below 960 px (F35.5)', () => {
  beforeEach(async () => {
    await setupShell();
    withStyle('bento');
    stubViewport(720);
  });
  afterEach(() => teardownShell());

  it('(F35.5) the rail is still the navigation; note routes open the folders as a drawer', async () => {
    const user = userEvent.setup();
    renderShell(noteUrl());
    expect(within(nav()).getByRole('link', { name: 'Hôm nay' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Thư mục' })).toBeNull();
    await user.keyboard('{Alt>}1{/Alt}');
    expect(screen.getByRole('dialog', { name: 'Thư mục' })).toBeInTheDocument();
    // The right panel stays in the page, after the screen.
    expect(screen.getByRole('complementary', { name: vi_.panel.label })).toBeInTheDocument();
  });
});

describe('bento at 600 px or less: bottom tab bar (F28.1)', () => {
  beforeEach(async () => {
    await setupShell();
    withStyle('bento');
    stubViewport(360);
  });
  afterEach(() => teardownShell());

  it('(F28.1) Hôm nay, Việc, Lịch, Ghi nhanh and Thêm; Ghi nhanh opens quick capture', async () => {
    const user = userEvent.setup();
    renderShell('/tasks');
    const items = within(nav()).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Hôm nay',
      'Việc',
      'Lịch',
      'Ghi nhanh',
      'Thêm',
    ]);
    expect(within(nav()).getByRole('link', { name: 'Việc cần làm' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await user.click(within(nav()).getByRole('button', { name: 'Ghi nhanh vào Inbox' }));
    expect(useCaptureUi.getState().isOpen).toBe(true);
  });

  it('(F28.1) "Thêm" lists the other places, Thư mục and Cài đặt; focus is trapped and returns', async () => {
    const user = userEvent.setup();
    const { router } = renderShell('/');
    const more = within(nav()).getByRole('button', { name: 'Thêm mục khác' });
    await user.click(more);
    const dialog = sheet('Thêm') as HTMLElement;
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const names = within(dialog)
      .getAllByRole('listitem')
      .map((li) => li.firstElementChild?.getAttribute('aria-label') ?? li.textContent);
    expect(names).toEqual([
      'Bản đồ não',
      'Hỏi AI',
      'Tài liệu',
      'Thẻ',
      'Nhắc nhở',
      'Thư mục',
      'Cài đặt',
    ]);
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    // Tab from the last entry wraps to the first control of the sheet.
    within(dialog).getByRole('link', { name: 'Cài đặt' }).focus();
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(sheet('Thêm')).toBeNull();
    expect(more).toHaveFocus();

    // Choosing a place navigates and closes the sheet.
    await user.click(more);
    await user.click(within(sheet('Thêm') as HTMLElement).getByRole('link', { name: 'Thẻ' }));
    expect(router.state.location.pathname).toBe('/tags');
    expect(sheet('Thêm')).toBeNull();
  });

  it('(F28.1) Thư mục in "Thêm" opens the folder drawer; closing it returns to "Thêm"', async () => {
    const user = userEvent.setup();
    renderShell('/');
    const more = within(nav()).getByRole('button', { name: 'Thêm mục khác' });
    await user.click(more);
    await user.click(within(sheet('Thêm') as HTMLElement).getByRole('button', { name: 'Thư mục' }));
    expect(sheet('Thêm')).toBeNull();
    const drawer = screen.getByRole('dialog', { name: 'Thư mục' });
    expect(within(drawer).getByRole('tree')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Thư mục' })).toBeNull();
    expect(more).toHaveFocus();
  });

  it('(F28.1) the reminders count moves to "Thêm"', async () => {
    const { useRemindersStore } = await import('../features/reminders/reminders-store');
    renderShell('/');
    act(() => useRemindersStore.setState({ reminders: [{ id: 'a' }, { id: 'b' }] } as never));
    expect(
      within(nav()).getByRole('button', { name: 'Thêm mục khác, 2 nhắc nhở' }),
    ).toBeInTheDocument();
  });

  it('(F28.1) the right panel is a bottom sheet behind the Alt+2 toggle, focus trapped', async () => {
    const user = userEvent.setup();
    renderShell(noteUrl());
    expect(screen.queryByRole('complementary', { name: vi_.panel.label })).toBeNull();
    const toggle = screen.getByRole('button', { name: vi_.panes.showRight });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    const panelSheet = sheet(vi_.panel.label) as HTMLElement;
    expect(
      within(panelSheet).getByRole('complementary', { name: vi_.panel.label }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: vi_.panes.hideRight })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await waitFor(() => expect(panelSheet).toContainElement(document.activeElement as HTMLElement));
    await user.tab();
    await user.tab();
    await user.tab();
    expect(panelSheet).toContainElement(document.activeElement as HTMLElement);
    await user.click(within(panelSheet).getByRole('button', { name: 'Đóng' }));
    expect(sheet(vi_.panel.label)).toBeNull();
    expect(screen.getByRole('button', { name: vi_.panes.showRight })).toHaveFocus();
    // Alt+2 opens it again; Esc closes it.
    await user.keyboard('{Alt>}2{/Alt}');
    expect(sheet(vi_.panel.label)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(sheet(vi_.panel.label)).toBeNull();
  });
});

describe('calm at 600 px or less (F28.1)', () => {
  beforeEach(async () => {
    await setupShell();
    stubViewport(360);
  });
  afterEach(() => teardownShell());

  it('(F28.1) the sidebar is a drawer behind the menu button, with navigation and folders', async () => {
    const user = userEvent.setup();
    renderShell('/');
    expect(screen.queryByRole('complementary', { name: vi_.sidebar.label })).toBeNull();
    const menu = screen.getByRole('button', { name: 'Điều hướng và thư mục' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    await user.click(menu);
    const drawer = screen.getByRole('dialog', { name: 'Điều hướng và thư mục' });
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(within(drawer).getByRole('navigation', { name: vi_.nav.label })).toBeInTheDocument();
    expect(within(drawer).getByRole('tree')).toBeInTheDocument();
    expect(
      within(drawer).getByRole('button', { name: vi_.sidebar.searchLabel }),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Điều hướng và thư mục' })).toBeNull();
    expect(menu).toHaveFocus();
    // Alt+1 opens it too; a place chosen in it navigates and closes it.
    await user.keyboard('{Alt>}1{/Alt}');
    await user.click(
      within(screen.getByRole('dialog', { name: 'Điều hướng và thư mục' })).getByRole('link', {
        name: vi_.nav.calendar,
      }),
    );
    expect(screen.queryByRole('dialog', { name: 'Điều hướng và thư mục' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Màn hình Lịch' })).toBeInTheDocument();
  });

  it('(F28.1) the calm right panel is a bottom sheet too', async () => {
    const user = userEvent.setup();
    renderShell('/calendar');
    expect(screen.queryByRole('complementary', { name: vi_.panel.label })).toBeNull();
    await user.click(screen.getByRole('button', { name: vi_.panes.showRight }));
    expect(sheet(vi_.panel.label)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(sheet(vi_.panel.label)).toBeNull();
    expect(screen.getByRole('button', { name: vi_.panes.showRight })).toHaveFocus();
  });
});
