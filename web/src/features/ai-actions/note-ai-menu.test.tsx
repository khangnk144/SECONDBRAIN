import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installRangeLayoutShim } from '../../editor/__tests__/jsdom-layout';
import { ApiError } from '../../lib/api-client';
import { availableCommands } from '../../lib/commands/command-registry';
import { installShortcutListener } from '../../lib/shortcuts/shortcut-registry';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { closeDraftDatabase } from '../drafts/draft-database';
import { renderNoteScreen, settleUi } from '../note/note-screen-test-kit';
import { resetNoteSessions } from '../note-session/session-registry';
import {
  freshDraftDatabase,
  installFakeNoteServer,
  useSessionFakeTimers,
  type FakeNoteServer,
} from '../note-session/session-test-kit';
import {
  aiButton,
  chooseAction,
  pendingUntilAborted,
  realEditor,
  selectText,
} from './__tests__/note-ai-test-kit';
import { aiActionTarget } from './ai-action-target';
import { readyStatus, setAiStatus } from './ai-actions-test-kit';

const runAiAction = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/ai-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/ai-api')>()),
  runAiAction,
}));

const PATH = '1 Projects/Đồ án Giải tích.md';
const SEARCH = `path=${encodeURIComponent(PATH)}`;
const CONTENT = '# Đồ án\n\nPhương pháp **Newton** tìm nghiệm gần đúng.\n\nĐoạn cuối.\n';

describe('the AI menu on a selection; nothing is sent while AI is not ready (F33.3)', () => {
  let server: FakeNoteServer;

  beforeAll(installRangeLayoutShim);
  beforeEach(async () => {
    await resetAppState('vault-a');
    await freshDraftDatabase();
    useSessionFakeTimers();
    server = installFakeNoteServer(PATH, CONTENT);
    runAiAction.mockReset();
  });
  afterEach(async () => {
    resetNoteSessions();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await closeDraftDatabase();
  });

  it('shows nothing before the AI status is known; disabled states say why', async () => {
    await renderNoteScreen(SEARCH);
    expect(screen.queryByRole('button', { name: 'AI cho đoạn đã chọn' })).toBeNull();
    act(() => setAiStatus(readyStatus({ ready: false, reason: 'disabled' })));
    expect(aiButton()).toHaveAttribute('aria-disabled', 'true');
    expect(aiButton()).toHaveAccessibleDescription('Bật AI trong Cài đặt để dùng');
    // After a provider change the switch is still on: only the new consent is missing.
    act(() => setAiStatus(readyStatus({ ready: false, reason: 'no-consent' })));
    expect(aiButton()).toHaveAccessibleDescription(
      'Bạn vừa đổi nhà cung cấp AI. Mở Cài đặt, mục AI, bấm Xem và đồng ý.',
    );
    act(() => setAiStatus(readyStatus({ scope: ['', '0 Inbox'] })));
    expect(aiButton()).toHaveAccessibleDescription('Ghi chú này nằm ngoài thư mục AI được đọc');
    act(() => setAiStatus(readyStatus()));
    expect(aiButton()).toHaveAccessibleDescription('Chọn một đoạn văn để dùng AI');
    selectText('Newton');
    expect(aiButton()).not.toHaveAttribute('aria-disabled');
    // A disabled button opens no menu; nothing was ever asked.
    act(() => setAiStatus(readyStatus({ ready: false, reason: 'no-key' })));
    fireEvent.click(aiButton());
    expect(screen.queryByRole('menu')).toBeNull();
    expect(runAiAction).not.toHaveBeenCalled();
  });

  it('sends nothing when AI is not ready; the panel says why and leads to Settings', async () => {
    await renderNoteScreen(SEARCH);
    act(() => setAiStatus(readyStatus({ ready: false, reason: 'budget' })));
    selectText('Newton');
    act(() => aiActionTarget()?.start('summarize'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Đã dùng hết hạn mức tháng này (2.000.000 token).',
    );
    expect(screen.getByRole('button', { name: 'Mở Cài đặt AI' })).toBeInTheDocument();
    act(() => setAiStatus(readyStatus({ scope: ['0 Inbox'] })));
    act(() => aiActionTarget()?.start('explain'));
    expect(screen.getByRole('alert')).toHaveTextContent('nằm ngoài thư mục AI được đọc');
    await settleUi(1000);
    expect(runAiAction).not.toHaveBeenCalled();
    expect(server.mock.callsTo('PUT /api/note')).toHaveLength(0);
  });

  it('palette commands are listed while the editor holds a selection, and open the panel', async () => {
    await renderNoteScreen(SEARCH);
    act(() => setAiStatus(readyStatus()));
    const ids = () => availableCommands().map((command) => command.id);
    expect(ids()).not.toContain('ai-summarize');
    expect(ids()).toContain('ai-tidy-inbox');
    selectText('Newton');
    expect(ids()).toEqual(expect.arrayContaining(['ai-summarize', 'ai-suggest-tags']));
    runAiAction.mockResolvedValue({ action: 'explain', text: 'Giải thích.' });
    act(() =>
      availableCommands()
        .find((c) => c.id === 'ai-explain')
        ?.run(),
    );
    await settleUi();
    expect(runAiAction).toHaveBeenCalledWith(
      { action: 'explain', text: '**Newton**', path: PATH },
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(screen.getByRole('dialog', { name: 'Giải thích' })).toHaveTextContent('Giải thích.');
  });

  it('"Hủy" aborts the request and nothing is inserted; Esc closes the panel', async () => {
    await renderNoteScreen(SEARCH);
    act(() => setAiStatus(readyStatus()));
    runAiAction.mockImplementation(pendingUntilAborted());
    selectText('Phương', 'gần');
    chooseAction('Tóm tắt');
    const dialog = screen.getByRole('dialog', { name: 'Tóm tắt' });
    expect(within(dialog).getByRole('status')).toHaveTextContent('Đang hỏi AI…');
    expect(screen.getByText('Đoạn đã chọn được gửi tới Anthropic (Claude).')).toBeInTheDocument();
    expect(runAiAction.mock.calls[0]?.[0]).toEqual({
      action: 'summarize',
      text: 'Phương pháp **Newton** tìm nghiệm gần',
      path: PATH,
    });
    const signal = (runAiAction.mock.calls[0]?.[1] as { signal: AbortSignal }).signal;
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(realEditor().view.hasFocus()).toBe(true);
    chooseAction('Giải thích');
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Giải thích' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await settleUi(1000);
    expect(server.mock.callsTo('PUT /api/note')).toHaveLength(0);
  });

  it('searching by meaning: link suggestions also name the embedding provider, a summary does not', async () => {
    await renderNoteScreen(SEARCH);
    const hybrid = readyStatus({
      retrieval: 'hybrid',
      embeddings: { ...readyStatus().embeddings, enabled: true, consented: true, hasKey: true },
    });
    act(() => setAiStatus(hybrid));
    runAiAction.mockImplementation(pendingUntilAborted());
    selectText('Newton');
    chooseAction('Gợi ý liên kết');
    expect(screen.getByRole('dialog', { name: 'Gợi ý liên kết' })).toHaveTextContent(
      'Đoạn đã chọn và vài đoạn trích từ các ghi chú liên quan được gửi tới Anthropic (Claude). ' +
        'Đoạn đã chọn cũng được gửi tới OpenAI để tìm theo nghĩa.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    selectText('Newton');
    chooseAction('Tóm tắt');
    const summary = screen.getByRole('dialog', { name: 'Tóm tắt' });
    expect(summary).toHaveTextContent('Đoạn đã chọn được gửi tới Anthropic (Claude).');
    expect(summary).not.toHaveTextContent('tìm theo nghĩa');
  });

  it('errors are reason-specific and "Thử lại" asks again', async () => {
    await renderNoteScreen(SEARCH);
    act(() => setAiStatus(readyStatus({ provider: 'openai' })));
    runAiAction
      .mockRejectedValueOnce(new ApiError(502, 'AI_PROVIDER_ERROR', 'x', { reason: 'network' }))
      .mockResolvedValueOnce({ action: 'summarize', text: 'Bản tóm tắt.' });
    selectText('Newton');
    chooseAction('Tóm tắt');
    await settleUi();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Không kết nối được với OpenAI. Kiểm tra mạng rồi thử lại.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await settleUi();
    expect(runAiAction).toHaveBeenCalledTimes(2);
    expect(runAiAction.mock.calls[1]?.[0]).toEqual(runAiAction.mock.calls[0]?.[0]);
    expect(screen.getByText('Bản tóm tắt.')).toBeInTheDocument();
    expect(screen.getByText('AI đề xuất')).toBeInTheDocument();
  });

  it('"Sao chép" copies the AI text; switching to source mode closes the panel', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await renderNoteScreen(SEARCH);
    act(() => setAiStatus(readyStatus()));
    runAiAction.mockResolvedValue({ action: 'summarize', text: 'Tóm tắt ngắn.' });
    selectText('Newton');
    chooseAction('Tóm tắt');
    await settleUi();
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép' }));
    await settleUi();
    expect(writeText).toHaveBeenCalledWith('Tóm tắt ngắn.');
    expect(screen.getByRole('dialog', { name: 'Tóm tắt' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chế độ nguồn' }));
    await settleUi();
    expect(screen.queryByRole('dialog', { name: 'Tóm tắt' })).toBeNull();
    expect(aiButton()).toHaveAccessibleDescription('Thoát chế độ nguồn để dùng AI');
    await settleUi(1000);
    expect(server.mock.callsTo('PUT /api/note')).toHaveLength(0);
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('keyboard only: Alt+A opens the menu, arrows and Enter choose, the result takes focus', async () => {
    const uninstall = installShortcutListener();
    try {
      await renderNoteScreen(SEARCH);
      act(() => setAiStatus(readyStatus()));
      runAiAction.mockResolvedValue({ action: 'explain', text: 'Một cách tìm nghiệm.' });
      selectText('Newton');
      act(() => realEditor().view.focus());
      // Alt+A pressed in the editor (the keydown reaches the app's shortcut listener).
      fireEvent.keyDown(realEditor().view.dom, { key: 'a', code: 'KeyA', altKey: true });
      expect(screen.getByRole('menuitem', { name: 'Tóm tắt' })).toHaveFocus();
      for (const key of ['ArrowDown', 'ArrowDown'])
        fireEvent.keyDown(document.activeElement!, { key });
      expect(screen.getByRole('menuitem', { name: 'Giải thích' })).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
      await settleUi();
      expect(runAiAction.mock.calls[0]?.[0]).toMatchObject({ action: 'explain' });
      const insert = screen.getByRole('button', { name: 'Chèn bên dưới' });
      expect(insert).toHaveFocus();
      // Enter on a focused button activates it (the browser turns it into a click).
      fireEvent.click(insert);
      await settleUi(600);
      expect(server.content).toBe(
        CONTENT.replace(
          'gần đúng.\n\n',
          'gần đúng.\n\n> **Giải thích (AI):** Một cách tìm nghiệm.\n\n',
        ),
      );
      expect(realEditor().view.hasFocus()).toBe(true);
      // Esc in the menu (opened from the editor) puts the caret back in the editor.
      selectText('cuối');
      fireEvent.keyDown(realEditor().view.dom, { key: 'a', code: 'KeyA', altKey: true });
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      expect(realEditor().view.hasFocus()).toBe(true);
      // Not ready: Alt+A shows the reason on the focused button, no menu.
      act(() => setAiStatus(readyStatus({ ready: false, reason: 'disabled' })));
      fireEvent.keyDown(realEditor().view.dom, { key: 'a', code: 'KeyA', altKey: true });
      expect(aiButton()).toHaveFocus();
      expect(screen.getByRole('tooltip')).toHaveTextContent('Bật AI trong Cài đặt để dùng');
      expect(screen.queryByRole('menu')).toBeNull();
    } finally {
      uninstall();
    }
  });
});
