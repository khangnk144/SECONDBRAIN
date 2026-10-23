import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import vi_ from '../i18n/vi.json';
import { applyUiPrefsLive } from '../lib/ui-prefs-live';
import { useUiPrefsStore } from '../lib/ui-prefs-store';
import { noteUrl, renderShell, setupShell, teardownShell } from './__tests__/shell-test-kit';

function setStyle(style: 'bento' | 'calm') {
  act(() => applyUiPrefsLive({ ...useUiPrefsStore.getState().prefs, style }));
}

describe('the frame follows the style at once (F35.1, F35.2)', () => {
  beforeEach(async () => {
    await setupShell();
  });
  afterEach(() => teardownShell());

  it('(F35.2) calm shows the previous sidebar frame; bento the rail, top bar and folder pane', () => {
    const { container } = renderShell(noteUrl());
    const shell = container.querySelector('.app-shell') as HTMLElement;
    expect(screen.getByRole('complementary', { name: vi_.sidebar.label })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: vi_.sidebar.searchLabel })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tìm ghi chú hoặc hỏi AI' })).toBeNull();
    expect(shell).not.toHaveClass('app-shell--bento');

    setStyle('bento');
    expect(document.documentElement.dataset.style).toBe('bento');
    expect(shell).toHaveClass(
      'app-shell--bento',
      'app-shell--with-folders',
      'app-shell--with-panel',
    );
    expect(screen.queryByRole('complementary', { name: vi_.sidebar.label })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Thư mục' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tìm ghi chú hoặc hỏi AI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi chú mới' })).toBeInTheDocument();
    // The main region, its tab row and the right panel are the same in both styles.
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('navigation', { name: 'Thẻ ghi chú đang mở' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: vi_.panel.label })).toBeInTheDocument();

    setStyle('calm');
    expect(screen.getByRole('complementary', { name: vi_.sidebar.label })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Thư mục' })).toBeNull();
  });
});

describe('focus survives a style switch (review B10)', () => {
  beforeEach(async () => {
    await setupShell();
  });
  afterEach(() => teardownShell());

  const radio = (value: string) =>
    document.querySelector<HTMLInputElement>(`input[name="settings-style"][value="${value}"]`);

  it('the focused radio is focused again in the new frame', () => {
    renderShell('/radios');
    const before = radio('bento');
    before?.focus();
    expect(document.activeElement).toBe(before);
    setStyle('bento');
    // A new frame: the radio is a new element, and it has focus (not <body>).
    expect(radio('bento')).not.toBe(before);
    expect(document.activeElement).toBe(radio('bento'));
    radio('calm')?.focus();
    setStyle('calm');
    expect(document.activeElement).toBe(radio('calm'));
  });

  it('a control that is gone leaves focus on the main region; nothing focused moves nothing', () => {
    renderShell('/radios');
    const search = screen.getByRole('button', { name: vi_.sidebar.searchLabel });
    search.focus();
    setStyle('bento'); // the calm sidebar's search button has no twin in Bento
    expect(document.activeElement).toBe(screen.getByRole('main'));
    (document.activeElement as HTMLElement).blur();
    setStyle('calm');
    expect(document.activeElement).toBe(document.body);
  });
});
