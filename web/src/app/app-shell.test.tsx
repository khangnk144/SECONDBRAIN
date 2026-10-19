import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n, i18n } from '../i18n';
import { resetAppState } from '../lib/testing/reset-app-state';
import { useUiPrefsStore } from '../lib/ui-prefs-store';
import { DEFAULT_UI_PREFS } from '../lib/ui-prefs';
import { appRoutes } from './routes';
import vi_ from '../i18n/vi.json';
import en from '../i18n/en.json';

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('app shell', () => {
  beforeEach(async () => {
    await resetAppState();
    initI18n('vi');
    await i18n.changeLanguage('vi');
    useUiPrefsStore.getState().setPrefs({ ...DEFAULT_UI_PREFS, name: 'khangnie' });
  });

  it('shows the sidebar navigation in Vietnamese by default', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: vi_.nav.label });
    for (const label of [
      vi_.nav.today,
      vi_.nav.tasks,
      vi_.nav.calendar,
      vi_.nav.graph,
      vi_.nav.tags,
    ]) {
      expect(nav).toHaveTextContent(label);
    }
    expect(screen.getByRole('link', { name: vi_.nav.today })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('greets the user by name on Today', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 18, 19, 45));
    renderAt('/');
    vi.useRealTimers();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Chào buổi tối, khangnie.');
    expect(screen.getByText(vi_.today.summaryNothingUrgent)).toBeInTheDocument();
    expect(screen.getByText('Chủ nhật, 18 tháng 10')).toBeInTheDocument();
  });

  it('skip link focuses the main region without changing the route', () => {
    renderAt('/');
    const skip = screen.getByRole('link', { name: vi_.app.skipToContent });
    const notPrevented = fireEvent.click(skip);
    expect(notPrevented).toBe(false);
    expect(screen.getByRole('main')).toHaveFocus();
    expect(screen.getByText(vi_.today.summaryNothingUrgent)).toBeInTheDocument();
  });

  it('switches every visible label to English without reloading', async () => {
    renderAt('/');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    const nav = screen.getByRole('navigation', { name: en.nav.label });
    expect(nav).toHaveTextContent(en.nav.tasks);
    expect(nav).not.toHaveTextContent(vi_.nav.tasks);
    expect(screen.getByText(en.today.summaryNothingUrgent)).toBeInTheDocument();
  });

  it('renders placeholder screens and marks their nav item active', () => {
    renderAt('/calendar');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      vi_.placeholder.calendar.title,
    );
    expect(screen.getByRole('link', { name: vi_.nav.calendar })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows a friendly not-found screen with a way back', () => {
    renderAt('/khong-co');
    expect(screen.getByRole('link', { name: vi_.placeholder.notFound.back })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('hides the right panel on Today', () => {
    renderAt('/');
    expect(screen.queryByRole('complementary', { name: vi_.panel.label })).toBeNull();
    expect(screen.getByRole('complementary', { name: vi_.sidebar.label })).toBeInTheDocument();
  });
});
