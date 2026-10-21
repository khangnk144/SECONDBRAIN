import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceFile, ResourceText } from '../../lib/api/resources-types';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { ResourcesScreen, TEXT_STATE_REFRESH_MS } from './resources-screen';

function pdf(name: string, text: ResourceText | null): ResourceFile {
  return {
    path: `3 Resources/papers/${name}`,
    name,
    folder: '3 Resources/papers',
    kind: 'pdf',
    size: 1_000,
    mtime: new Date(2026, 9, 21).getTime(),
    referencedBy: [],
    text,
  };
}

const text = (quality: ResourceText['quality'], reason: string | null = null): ResourceText => ({
  quality,
  pages: quality === 'pending' ? null : 12,
  reason,
});

const row = (name: string) => screen.getByText(name).closest('li')!;

describe('documents view: what could be read of each PDF (F30.2)', () => {
  let mock: FetchMock;
  let files: ResourceFile[];

  beforeEach(async () => {
    await resetAppState('vault-a');
    files = [
      pdf('Đọc tốt.pdf', text('ok')),
      pdf('Đang chờ.pdf', text('pending')),
      pdf('Một phần.pdf', text('low', 'sparse-text')),
      pdf('Quá dài.pdf', text('low', 'too-large')),
      pdf('Bản scan.pdf', text('none', 'no-text')),
      pdf('Có mật khẩu.pdf', text('none', 'encrypted')),
      pdf('Hỏng.pdf', text('none', 'damaged')),
      pdf('Lạ.pdf', text('none', 'something-new')),
      pdf('Cũ.pdf', null),
    ];
    mock = installFetchMock();
    mock.on('GET /api/resources', () => ({ body: { files } }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('says nothing for a fully read file and names the state, with a hint by reason', async () => {
    render(<ResourcesScreen />);
    await screen.findByText('Đọc tốt.pdf');
    for (const name of ['Đọc tốt.pdf', 'Cũ.pdf']) {
      expect(row(name).querySelector('.resource-row__text')).toBeNull();
    }
    expect(within(row('Đang chờ.pdf')).getByText('Đang đọc chữ…')).toBeInTheDocument();
    const sparse = row('Một phần.pdf');
    expect(within(sparse).getByText('Đọc được một phần chữ')).toBeInTheDocument();
    // Slides and title pages have little text: that is not called a scan (only `none` is).
    expect(
      within(sparse).getByText(
        'Một số trang có rất ít chữ (ví dụ trang chỉ có hình). Tìm kiếm và AI chỉ đọc được phần có chữ.',
      ),
    ).toBeInTheDocument();
    expect(sparse).not.toHaveTextContent(/scan/);
    expect(within(row('Quá dài.pdf')).getByText(/chỉ đọc được phần đầu/)).toBeInTheDocument();
    const scan = row('Bản scan.pdf');
    expect(within(scan).getByText('Không đọc được chữ')).toBeInTheDocument();
    expect(
      within(scan).getByText('Có thể đây là bản scan. AI và tìm kiếm sẽ không đọc được tệp này.'),
    ).toBeInTheDocument();
    expect(within(row('Có mật khẩu.pdf')).getByText(/^Tệp có mật khẩu\./)).toBeInTheDocument();
    expect(within(row('Hỏng.pdf')).getByText(/Tệp có thể bị hỏng/)).toBeInTheDocument();
    // An unknown reason still says the state, without a made-up explanation.
    const unknown = row('Lạ.pdf');
    expect(within(unknown).getByText('Không đọc được chữ')).toBeInTheDocument();
    expect(unknown.querySelector('.resource-row__text-hint')).toBeNull();
  });

  it('refreshes the rows once a burst of `source:extracted` settles', async () => {
    render(<ResourcesScreen />);
    await screen.findByText('Đang chờ.pdf');
    vi.useFakeTimers();
    files = files.map((file) =>
      file.name === 'Đang chờ.pdf' ? { ...file, text: text('none', 'no-text') } : file,
    );
    act(() => {
      emitServerEvent({ type: 'source:extracted', path: files[1]!.path, quality: 'none' });
      emitServerEvent({ type: 'source:extracted', path: files[0]!.path, quality: 'ok' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEXT_STATE_REFRESH_MS - 10);
    });
    expect(mock.callsTo('GET /api/resources')).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(mock.callsTo('GET /api/resources')).toHaveLength(2);
    expect(within(row('Đang chờ.pdf')).getByText('Không đọc được chữ')).toBeInTheDocument();
  });
});
