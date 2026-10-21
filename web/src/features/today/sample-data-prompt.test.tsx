import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { useVaultStore } from '../../lib/vault-store';
import { SampleDataPrompt } from './sample-data-prompt';

function renderPrompt() {
  const onCreated = vi.fn();
  const focusAfter = vi.fn();
  const utils = render(<SampleDataPrompt onCreated={onCreated} focusAfter={focusAfter} />);
  return { ...utils, onCreated, focusAfter };
}

describe('first-run sample data prompt', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
    mock.on('GET /api/sample-data', { body: { offered: true, present: false } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks calmly with Yes focused; Yes creates the set and Today reloads', async () => {
    const user = userEvent.setup();
    mock.on('POST /api/sample-data', {
      status: 201,
      body: { created: ['2 Areas/Giải tích 1.md'] },
    });
    const { onCreated, focusAfter } = renderPrompt();
    expect(
      await screen.findByRole('heading', { name: 'Tạo dữ liệu mẫu để xem thử?' }),
    ).toBeVisible();
    const yes = screen.getByRole('button', { name: 'Tạo dữ liệu mẫu' });
    expect(yes).toHaveFocus();
    expect(yes).toHaveClass('button--primary');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(mock.callsTo('POST /api/sample-data')).toHaveLength(1);
    expect(focusAfter).toHaveBeenCalledWith(false); // by keyboard: the focus ring is wanted
    expect(useToastStore.getState().toasts[0]?.message).toBe('Đã tạo dữ liệu mẫu.');
    expect(screen.queryByRole('heading', { name: 'Tạo dữ liệu mẫu để xem thử?' })).toBeNull();
  });

  it('"Không, cảm ơn" is remembered for this vault only', async () => {
    const user = userEvent.setup();
    const first = renderPrompt();
    await user.click(await screen.findByRole('button', { name: 'Không, cảm ơn' }));
    expect(screen.queryByRole('button', { name: 'Tạo dữ liệu mẫu' })).toBeNull();
    expect(first.focusAfter).toHaveBeenCalledWith(true); // a mouse click: no ring needed
    first.unmount();

    renderPrompt();
    await waitFor(() => expect(mock.callsTo('GET /api/sample-data').length).toBeGreaterThan(1));
    expect(screen.queryByRole('button', { name: 'Tạo dữ liệu mẫu' })).toBeNull();
    useVaultStore.setState({ vaultId: 'vault-b' });
    expect(await screen.findByRole('button', { name: 'Tạo dữ liệu mẫu' })).toBeInTheDocument();
    expect(mock.callsTo('POST /api/sample-data')).toHaveLength(0);
  });

  it('shows nothing when the vault already has notes', async () => {
    mock.on('GET /api/sample-data', { body: { offered: false, present: false } });
    const { container } = renderPrompt();
    await waitFor(() => expect(mock.callsTo('GET /api/sample-data')).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });
});
