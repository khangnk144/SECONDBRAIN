import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { makeTree } from '../../lib/testing/tree-fixture';
import { useToastStore } from '../../lib/toast-store';
import { readyStatus, setAiStatus } from '../ai-actions/ai-actions-test-kit';
import { pendingUntilAborted } from '../ai-actions/__tests__/note-ai-test-kit';
import { DialogHost } from '../dialogs/dialog-host';
import { InboxTidyDialogHost } from './inbox-tidy-dialog-host';
import { openInboxTidy, resetInboxTidy, useInboxTidy } from './inbox-tidy-store';

const runAiAction = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/ai-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/ai-api')>()),
  runAiAction,
}));

const FIRST = '0 Inbox/ghi nhanh 1.md';
const SECOND = '0 Inbox/Ý tưởng.md';
const CONTENT: Record<string, string> = {
  [FIRST]: '---\ntype: note\n---\n# ghi nhanh 1\n\nKế hoạch cho đồ án Giải tích.\n',
  [SECOND]: '- [ ] làm app ghi chú\n',
};
const PROPOSAL = {
  current: { folder: '0 Inbox', title: 'ghi nhanh 1' },
  folder: '1 Projects/Đồ án',
  title: 'Kế hoạch đồ án',
  reason: 'Ghi chú nói về đồ án Giải tích.',
  keep: false,
};

let mock: FetchMock;
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const toasts = () => useToastStore.getState().toasts;
/** A keyboard press on a button: focus on it, then the click Enter/Space gives. */
const press = (button: HTMLElement) => {
  act(() => button.focus());
  fireEvent.click(button);
};
const row = (title: string) =>
  screen.getByText(title, { selector: '.inbox-tidy__title' }).closest('li') as HTMLElement;

async function openDialog(mode?: Parameters<typeof openInboxTidy>[0]) {
  render(
    <>
      <InboxTidyDialogHost />
      <DialogHost />
    </>,
  );
  act(() => openInboxTidy(mode));
  await settle();
  await settle();
}

describe('Inbox tidying with AI (owner request R1)', () => {
  beforeEach(async () => {
    await resetAppState('vault-a');
    resetInboxTidy();
    runAiAction.mockReset();
    setAiStatus(readyStatus());
    mock = installFetchMock();
    mock.on('GET /api/tree', {
      body: makeTree({
        folders: ['0 Inbox', '1 Projects', '1 Projects/Đồ án'],
        notes: [FIRST, SECOND, '1 Projects/Khác.md'],
      }),
    });
    mock.on('GET /api/note', (call) => {
      const path = call.query.get('path') ?? '';
      return { body: { path, content: CONTENT[path] ?? '', revision: `rev-${path}`, utf8: true } };
    });
    const relink =
      (newPath: (body: Record<string, string>) => string) => (call: { body: unknown }) => {
        const body = call.body as Record<string, string> & { dryRun?: boolean };
        return body.dryRun
          ? { body: { dryRun: true, path: newPath(body), affected: [] } }
          : { body: { journalId: 'J1', path: newPath(body), affected: [] } };
      };
    mock.on(
      'POST /api/note/rename',
      relink((body) => body.newPath!),
    );
    mock.on(
      'POST /api/note/move',
      relink((body) => `${body.folder}/${body.path!.slice(body.path!.lastIndexOf('/') + 1)}`),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says why when AI is not ready or the Inbox is out of scope, and sends nothing', async () => {
    setAiStatus(readyStatus({ ready: false, reason: 'disabled' }));
    await openDialog();
    expect(screen.getByRole('alert')).toHaveTextContent('AI chưa bật.');
    expect(screen.getByRole('button', { name: 'Mở Cài đặt AI' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gợi ý chỗ để cho/ })).toBeNull();
    act(() => setAiStatus(readyStatus({ scope: ['1 Projects'] })));
    expect(screen.getByRole('alert')).toHaveTextContent('Inbox nằm ngoài thư mục AI được đọc');
    expect(runAiAction).not.toHaveBeenCalled();
  });

  it('lists every Inbox note with its first line; nothing is asked before "Gợi ý"', async () => {
    await openDialog();
    const list = screen.getByRole('list', { name: 'Ghi chú trong Inbox' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(
      within(row('ghi nhanh 1')).getByText('Kế hoạch cho đồ án Giải tích.'),
    ).toBeInTheDocument();
    expect(within(list).getByText('làm app ghi chú')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Bấm Gợi ý sẽ gửi nội dung ghi chú đó, tên các thư mục và tên vài ghi chú liên quan tới Anthropic (Claude).',
      ),
    ).toBeInTheDocument();
    expect(runAiAction).not.toHaveBeenCalled();
  });

  it('asks for one note at a time; "Hủy" aborts', async () => {
    runAiAction.mockImplementation(pendingUntilAborted());
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý chỗ để cho ghi nhanh 1' }));
    expect(within(row('ghi nhanh 1')).getByRole('status')).toHaveTextContent('Đang hỏi AI…');
    const other = screen.getByRole('button', { name: 'Gợi ý chỗ để cho Ý tưởng' });
    expect(other).toHaveAttribute('aria-disabled', 'true');
    expect(other).toHaveAccessibleDescription('Đang hỏi AI cho một ghi chú khác');
    fireEvent.click(other);
    expect(runAiAction).toHaveBeenCalledTimes(1);
    expect(runAiAction.mock.calls[0]?.[0]).toEqual({ action: 'suggest-placement', path: FIRST });
    const signal = (runAiAction.mock.calls[0]?.[1] as { signal: AbortSignal }).signal;
    fireEvent.click(within(row('ghi nhanh 1')).getByRole('button', { name: 'Hủy' }));
    expect(signal.aborted).toBe(true);
    expect(other).not.toHaveAttribute('aria-disabled');
  });

  it('"Áp dụng" moves and renames in one journaled operation with relink and a 10 s undo', async () => {
    runAiAction.mockResolvedValue(PROPOSAL);
    await openDialog();
    press(screen.getByRole('button', { name: 'Gợi ý chỗ để cho ghi nhanh 1' }));
    await settle();
    const proposal = row('ghi nhanh 1');
    const move = within(proposal).getByRole('checkbox', { name: 'Chuyển đến 1 Projects/Đồ án' });
    const rename = within(proposal).getByRole('checkbox', {
      name: 'Đổi tên thành “Kế hoạch đồ án”',
    });
    expect(move).toBeChecked();
    expect(rename).toBeChecked();
    // Focus left the pressed "Gợi ý" for the proposal's first control (keyboard flow).
    expect(move).toHaveFocus();
    expect(within(proposal).getByText(PROPOSAL.reason)).toBeInTheDocument();
    expect(mock.callsTo('POST /api/note/rename')).toHaveLength(0);
    press(within(proposal).getByRole('button', { name: 'Áp dụng' }));
    await settle();
    await settle();
    const calls = mock.callsTo('POST /api/note/rename');
    expect(calls.map((call) => call.body)).toEqual([
      {
        path: FIRST,
        newPath: '1 Projects/Đồ án/Kế hoạch đồ án.md',
        expectedRevision: `rev-${FIRST}`,
        relink: true,
        dryRun: true,
      },
      {
        path: FIRST,
        newPath: '1 Projects/Đồ án/Kế hoạch đồ án.md',
        expectedRevision: `rev-${FIRST}`,
        relink: true,
      },
    ]);
    expect(mock.callsTo('POST /api/note/move')).toHaveLength(0);
    expect(toasts()[0]).toMatchObject({
      message: 'Đã chuyển “ghi nhanh 1” đến 1 Projects/Đồ án và đổi tên thành “Kế hoạch đồ án”.',
      action: { label: 'Hoàn tác' },
      durationMs: 10_000,
    });
    const done = within(proposal).getByText('Đã áp dụng: giờ là 1 Projects/Đồ án/Kế hoạch đồ án.');
    expect(done).toHaveFocus();
  });

  it('only the checked parts are applied', async () => {
    runAiAction.mockResolvedValue(PROPOSAL);
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý chỗ để cho ghi nhanh 1' }));
    await settle();
    const proposal = row('ghi nhanh 1');
    const apply = within(proposal).getByRole('button', { name: 'Áp dụng' });
    fireEvent.click(within(proposal).getByRole('checkbox', { name: /Đổi tên/ }));
    fireEvent.click(within(proposal).getByRole('checkbox', { name: /Chuyển đến/ }));
    expect(apply).toHaveAttribute('aria-disabled', 'true');
    expect(apply).toHaveAccessibleDescription('Chọn ít nhất một thay đổi');
    fireEvent.click(apply);
    fireEvent.click(within(proposal).getByRole('checkbox', { name: /Chuyển đến/ }));
    fireEvent.click(apply);
    await settle();
    await settle();
    expect(mock.callsTo('POST /api/note/rename')).toHaveLength(0);
    expect(mock.callsTo('POST /api/note/move').map((call) => call.body)).toEqual([
      {
        path: FIRST,
        folder: '1 Projects/Đồ án',
        expectedRevision: `rev-${FIRST}`,
        relink: true,
        dryRun: true,
      },
      { path: FIRST, folder: '1 Projects/Đồ án', expectedRevision: `rev-${FIRST}`, relink: true },
    ]);
  });

  it('a rename alone stays in the Inbox', async () => {
    runAiAction.mockResolvedValue({
      ...PROPOSAL,
      current: { folder: '0 Inbox', title: 'Ý tưởng' },
    });
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý chỗ để cho Ý tưởng' }));
    await settle();
    fireEvent.click(within(row('Ý tưởng')).getByRole('checkbox', { name: /Chuyển đến/ }));
    fireEvent.click(within(row('Ý tưởng')).getByRole('button', { name: 'Áp dụng' }));
    await settle();
    await settle();
    expect(mock.callsTo('POST /api/note/rename').at(-1)?.body).toMatchObject({
      path: SECOND,
      newPath: '0 Inbox/Kế hoạch đồ án.md',
    });
    expect(mock.callsTo('POST /api/note/move')).toHaveLength(0);
  });

  it('"keep" and "Bỏ qua" change nothing; errors offer "Thử lại"', async () => {
    runAiAction
      .mockResolvedValueOnce({ ...PROPOSAL, keep: true, folder: '0 Inbox', title: 'ghi nhanh 1' })
      .mockRejectedValueOnce(new ApiError(502, 'AI_PROVIDER_ERROR', 'x', { reason: 'rate-limit' }))
      .mockResolvedValueOnce({ ...PROPOSAL, current: { folder: '0 Inbox', title: 'Ý tưởng' } });
    await openDialog();
    press(screen.getByRole('button', { name: 'Gợi ý chỗ để cho ghi nhanh 1' }));
    await settle();
    expect(
      within(row('ghi nhanh 1')).getByText('AI thấy ghi chú này để ở Inbox là hợp lý.'),
    ).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý chỗ để cho Ý tưởng' }));
    await settle();
    expect(within(row('Ý tưởng')).getByRole('alert')).toHaveTextContent(
      'Anthropic (Claude) đang giới hạn số lần hỏi.',
    );
    fireEvent.click(within(row('Ý tưởng')).getByRole('button', { name: 'Thử lại' }));
    await settle();
    press(within(row('Ý tưởng')).getByRole('button', { name: 'Bỏ qua' }));
    expect(within(row('Ý tưởng')).getByText('Đã bỏ qua đề xuất này.')).toHaveFocus();
    expect(mock.callsTo('POST /api/note/rename')).toHaveLength(0);
    expect(mock.callsTo('POST /api/note/move')).toHaveLength(0);
  });

  it('"Gợi ý chỗ để" for one note asks at once and closes after "Áp dụng"', async () => {
    runAiAction.mockResolvedValue(PROPOSAL);
    await openDialog({ kind: 'one', path: FIRST });
    expect(screen.getByRole('dialog', { name: 'Gợi ý chỗ để' })).toBeInTheDocument();
    expect(runAiAction).toHaveBeenCalledTimes(1);
    const list = screen.getByRole('list', { name: 'Ghi chú trong Inbox' });
    expect(list.querySelectorAll(':scope > li')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await settle();
    await settle();
    expect(useInboxTidy.getState().mode).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(runAiAction).toHaveBeenCalledTimes(1);
  });

  it('keyboard: after the last row is applied, Tab wraps inside the dialog and Esc still closes it', async () => {
    runAiAction.mockResolvedValue({
      ...PROPOSAL,
      current: { folder: '0 Inbox', title: 'Ý tưởng' },
    });
    render(
      <>
        <button type="button">Lịch</button>
        <InboxTidyDialogHost />
        <DialogHost />
        <button type="button">Sau hộp thoại</button>
      </>,
    );
    act(() => openInboxTidy());
    await settle();
    await settle();
    const user = userEvent.setup();
    press(screen.getByRole('button', { name: 'Gợi ý chỗ để cho Ý tưởng' }));
    await settle();
    press(within(row('Ý tưởng')).getByRole('button', { name: 'Áp dụng' }));
    await settle();
    await settle();
    // The outcome sentence of the last row took focus (it comes after every button).
    const done = within(row('Ý tưởng')).getByText(/^Đã áp dụng/);
    expect(done).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Đóng' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Gợi ý chỗ để cho ghi nhanh 1' })).toHaveFocus();
    // Focus fell out of the dialog (its element went away): Tab comes back in, Esc still closes.
    act(() => (document.activeElement as HTMLElement).blur());
    await user.tab();
    expect(screen.getByRole('button', { name: 'Đóng' })).toHaveFocus();
    act(() => (document.activeElement as HTMLElement).blur());
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Gợi ý chỗ để cho ghi nhanh 1' })).toHaveFocus();
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useInboxTidy.getState().mode).toBeNull();
  });

  it('searching by meaning: the list also names the embedding provider', async () => {
    setAiStatus(readyStatus({ retrieval: 'hybrid' }));
    await openDialog();
    expect(
      screen.getByText(/^Bấm Gợi ý sẽ gửi nội dung ghi chú đó/, { selector: '.modal__hint' }),
    ).toHaveTextContent(
      'tới Anthropic (Claude). Nội dung ghi chú đó cũng được gửi tới OpenAI để tìm theo nghĩa.',
    );
  });

  it('one note: says what was sent (once it was), and "Áp dụng" is the primary button', async () => {
    setAiStatus(readyStatus({ retrieval: 'hybrid' }));
    runAiAction.mockImplementation(pendingUntilAborted());
    await openDialog({ kind: 'one', path: FIRST });
    const dialog = screen.getByRole('dialog', { name: 'Gợi ý chỗ để' });
    expect(dialog).toHaveTextContent(
      'AI đề xuất thư mục và một tên rõ hơn cho ghi chú này. Không có gì thay đổi cho đến khi bạn bấm Áp dụng.',
    );
    // No "Gợi ý" button here, so no "Bấm Gợi ý sẽ gửi…": the click on the note sent it.
    expect(dialog).not.toHaveTextContent('Bấm Gợi ý');
    expect(dialog).toHaveTextContent(
      'Đã gửi ghi chú này, tên các thư mục và tên vài ghi chú liên quan tới Anthropic (Claude) để gợi ý chỗ để. ' +
        'Ghi chú này cũng đã được gửi tới OpenAI để tìm theo nghĩa.',
    );
    runAiAction.mockReset();
    runAiAction.mockResolvedValue(PROPOSAL);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    // Back to before the request: nothing is claimed as sent… until she asks again.
    expect(dialog).not.toHaveTextContent('Đã gửi');
    fireEvent.click(within(dialog).getByRole('button', { name: /Gợi ý chỗ để cho/ }));
    await settle();
    expect(within(dialog).getByRole('button', { name: 'Áp dụng' })).toHaveClass('button--primary');
    expect(within(dialog).getByRole('button', { name: 'Bỏ qua' })).toHaveClass('button--secondary');
  });

  it('in the list every "Áp dụng" stays a quiet button', async () => {
    runAiAction.mockResolvedValue(PROPOSAL);
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý chỗ để cho ghi nhanh 1' }));
    await settle();
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toHaveClass('button--secondary');
  });

  it('asks before rewriting other notes; the confirmation shows above the dialog', async () => {
    runAiAction.mockResolvedValue(PROPOSAL);
    mock.on('POST /api/note/rename', (call) =>
      (call.body as { dryRun?: boolean }).dryRun
        ? { body: { dryRun: true, path: 'x', affected: ['1 Projects/Khác.md'] } }
        : { body: { journalId: 'J2', path: '1 Projects/Đồ án/Kế hoạch đồ án.md', affected: [] } },
    );
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý chỗ để cho ghi nhanh 1' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await settle();
    const dialogs = screen.getAllByRole('dialog');
    const confirm = dialogs.at(-1)!;
    expect(confirm).toHaveTextContent('Khác');
    expect(mock.callsTo('POST /api/note/rename')).toHaveLength(1);
    fireEvent.click(within(confirm).getByRole('button', { name: /Chuyển/ }));
    await settle();
    await settle();
    expect(mock.callsTo('POST /api/note/rename')).toHaveLength(2);
  });
});
