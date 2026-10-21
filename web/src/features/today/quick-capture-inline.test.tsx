import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { QuickCaptureInline } from './quick-capture-inline';

describe('"Ghi nhanh" on Today (F12)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const box = () => screen.getByRole('textbox', { name: 'Ghi nhanh' });

  it('Enter saves to Inbox, empties the box and keeps focus; Shift+Enter adds a line', async () => {
    const user = userEvent.setup();
    mock.on('POST /api/capture', {
      status: 201,
      body: { path: '0 Inbox/Ý tưởng đồ án.md', revision: 'r1' },
    });
    render(<QuickCaptureInline />);
    expect(box()).toHaveAttribute('placeholder', 'Gõ gì đó rồi Enter…');
    await user.click(box());
    await user.keyboard('Ý tưởng đồ án{Shift>}{Enter}{/Shift}dòng hai');
    expect(box()).toHaveValue('Ý tưởng đồ án\ndòng hai');
    expect(mock.callsTo('POST /api/capture')).toHaveLength(0);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(box()).toHaveValue(''));
    expect(mock.callsTo('POST /api/capture')[0]?.body).toEqual({ text: 'Ý tưởng đồ án\ndòng hai' });
    expect(box()).toHaveFocus();
    expect(useToastStore.getState().toasts[0]?.message).toBe('Đã lưu vào Inbox.');
  });

  it('is read-only while saving (focus stays) and keeps the text when saving fails', async () => {
    const user = userEvent.setup();
    let fail: () => void = () => undefined;
    mock.on(
      'POST /api/capture',
      () => new Promise((resolve) => (fail = () => resolve(apiError(500, 'WRITE_FAILED')))),
    );
    render(<QuickCaptureInline />);
    await user.click(box());
    await user.keyboard('Gọi cho nhóm{Enter}');
    await waitFor(() => expect(box()).toHaveAttribute('readonly'));
    expect(box()).toHaveFocus();
    fail();
    await waitFor(() => expect(box()).not.toHaveAttribute('readonly'));
    expect(box()).toHaveValue('Gọi cho nhóm');
    expect(mock.callsTo('POST /api/capture')).toHaveLength(1);
  });

  it('an empty box and an Enter while an input method composes send nothing', async () => {
    const user = userEvent.setup();
    render(<QuickCaptureInline />);
    await user.click(box());
    await user.keyboard('   {Enter}');
    box().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    );
    expect(mock.callsTo('POST /api/capture')).toHaveLength(0);
  });
});
