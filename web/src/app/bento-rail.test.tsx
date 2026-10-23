import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { i18n } from '../i18n';
import vi_ from '../i18n/vi.json';
import { useRemindersStore } from '../features/reminders/reminders-store';
import { withStyle } from '../lib/testing/ui-style-test-kit';
import { renderShell, setupShell, teardownShell } from './__tests__/shell-test-kit';

const rail = () => screen.getByRole('navigation', { name: vi_.nav.label });

function setReminders(count: number) {
  const reminders = Array.from({ length: count }, (_, i) => ({ id: `r${i}` }));
  act(() => useRemindersStore.setState({ reminders } as never));
}

describe('bento rail (F35.2)', () => {
  beforeEach(async () => {
    await setupShell();
    withStyle('bento');
  });
  afterEach(() => teardownShell());

  it('(F35.2) lists the places in order with short labels, full names and tooltips', () => {
    renderShell('/');
    const entries = within(rail()).getAllByRole('listitem');
    const names = entries.map(
      (li) => (li.firstElementChild as HTMLElement).getAttribute('aria-label') ?? li.textContent,
    );
    expect(names).toEqual([
      'Hôm nay',
      'Việc cần làm',
      'Lịch',
      'Bản đồ não',
      'Hỏi AI',
      'Tài liệu',
      'Thẻ',
      'Nhắc nhở',
      'Thư mục',
      'Cài đặt',
    ]);
    const tasks = within(rail()).getByRole('link', { name: 'Việc cần làm' });
    expect(tasks).toHaveTextContent('Việc');
    expect(tasks).toHaveAttribute('title', 'Việc cần làm');
    expect(within(rail()).getByRole('link', { name: 'Bản đồ não' })).toHaveTextContent('Não');
    const settings = within(rail()).getByRole('link', { name: 'Cài đặt' });
    expect(settings).toHaveAttribute('title', 'Cài đặt (Alt+,)');
    expect(settings).toHaveAttribute('aria-keyshortcuts', 'Alt+,');
    // The calm sidebar is not there; its search and "Ghi chú mới" moved to the top bar.
    expect(screen.queryByRole('complementary', { name: vi_.sidebar.label })).toBeNull();
  });

  it('(F35.2) marks the current place with aria-current and follows navigation', async () => {
    const { router } = renderShell('/');
    expect(within(rail()).getByRole('link', { name: 'Hôm nay' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await act(() => router.navigate('/calendar'));
    expect(within(rail()).getByRole('link', { name: 'Lịch' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(rail()).getByRole('link', { name: 'Hôm nay' })).not.toHaveAttribute(
      'aria-current',
    );
    await act(() => router.navigate('/settings'));
    expect(within(rail()).getByRole('link', { name: 'Cài đặt' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('(F35.2) "Nhắc nhở" shows the count and says it in its name', () => {
    renderShell('/');
    setReminders(3);
    const link = within(rail()).getByRole('link', { name: 'Nhắc nhở, 3 nhắc nhở' });
    expect(link.querySelector('.rail-item__badge')).toHaveTextContent('3');
    expect(link.querySelector('.rail-item__badge')).toHaveAttribute('aria-hidden', 'true');
    setReminders(0);
    expect(
      within(rail()).getByRole('link', { name: 'Nhắc nhở' }).querySelector('.rail-item__badge'),
    ).toBeNull();
  });

  it('(F35.2) "Thư mục" is a toggle button with Alt+1 in its tooltip', async () => {
    const user = userEvent.setup();
    renderShell('/');
    const folders = within(rail()).getByRole('button', { name: 'Thư mục' });
    expect(folders).toHaveAttribute('aria-expanded', 'false');
    expect(folders).not.toHaveAttribute('aria-controls');
    expect(folders).toHaveAttribute('title', 'Thư mục (Alt+1)');
    await user.click(folders);
    expect(folders).toHaveAttribute('aria-expanded', 'true');
    const drawer = screen.getByRole('dialog', { name: 'Thư mục' });
    expect(folders).toHaveAttribute('aria-controls', drawer.id);
  });

  it('has English labels', async () => {
    await act(() => i18n.changeLanguage('en'));
    renderShell('/tasks');
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'Tasks' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Brain map' })).toHaveTextContent('Brain');
    expect(within(nav).getByRole('link', { name: 'Documents' })).toHaveTextContent('Documents');
    expect(within(nav).getByRole('button', { name: 'Folders' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search notes or ask AI' })).toBeInTheDocument();
  });
});
