import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type FetchMock } from '../../lib/testing/fetch-mock';
import { cssRule, readWebSource } from '../../lib/testing/read-source-file';
import { useTabsStore } from '../../lib/tabs-store';
import { TOAST_MS, useToastStore } from '../../lib/toast-store';
import { AiChat } from './ai-chat';
import { done, setUpChat, type ScriptedChat } from './chat-test-kit';
import { saveFolders } from './save-answer-dialog';

let chat: ScriptedChat;
let mock: FetchMock;
const SAVED = 'wiki/Tuần này có gì đến hạn.md';

async function answered(notePath: string | null) {
  ({ chat, mock } = await setUpChat());
  mock.on('POST /api/ai/save-answer', { status: 201, body: { path: SAVED } });
  render(<AiChat threadId="t" notePath={notePath} variant="panel" />);
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'Câu hỏi của bạn' }), 'Câu hỏi hay{Enter}');
  await vi.waitFor(() => expect(chat.requests).toHaveLength(1));
  act(() => {
    chat.send(done({ answer: 'Câu trả lời **hay**.' }));
    chat.end();
  });
  await user.click(await screen.findByRole('button', { name: 'Lưu thành ghi chú' }));
  return user;
}

describe('"Lưu thành ghi chú" (F33)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('offers the note folder first, else the Inbox, then wiki', () => {
    expect(saveFolders('1 Projects/Đồ án/Kế hoạch.md')).toEqual(['1 Projects/Đồ án', 'wiki']);
    expect(saveFolders(null)).toEqual(['0 Inbox', 'wiki']);
    expect(saveFolders('wiki/papers/A.md')).toEqual(['wiki/papers', 'wiki']);
    expect(saveFolders('wiki/A.md')).toEqual(['wiki']);
    expect(saveFolders('Gốc.md')).toEqual(['', 'wiki']);
  });

  it('saves to the chosen folder, then a 4 s toast offers "Mở"', async () => {
    const openNote = vi.fn();
    const user = await answered('2 Areas/Giải tích 1.md');
    useTabsStore.setState({ openNote });
    const dialog = screen.getByRole('dialog', { name: 'Lưu câu trả lời thành ghi chú' });
    const here = screen.getByRole('radio', { name: '2 Areas' });
    expect(here).toBeChecked();
    expect(here).toHaveFocus();
    await user.click(screen.getByRole('radio', { name: 'wiki' }));
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await vi.waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(mock.callsTo('POST /api/ai/save-answer')[0]?.body).toEqual({
      question: 'Câu hỏi hay',
      answer: 'Câu trả lời **hay**.',
      folder: 'wiki',
    });
    const toast = useToastStore.getState().toasts[0];
    expect(toast?.message).toBe('Đã lưu thành ghi chú');
    expect(toast?.durationMs).toBe(TOAST_MS);
    expect(toast?.action?.label).toBe('Mở');
    await toast?.action?.run();
    expect(openNote).toHaveBeenCalledWith(SAVED);
    // Focus is back on the button that opened the dialog.
    expect(screen.getByRole('button', { name: 'Lưu thành ghi chú' })).toHaveFocus();
  });

  it('from the Ask screen it defaults to the Inbox; a failure keeps the dialog with a message', async () => {
    const user = await answered(null);
    expect(screen.getByRole('radio', { name: '0 Inbox' })).toBeChecked();
    mock.on('POST /api/ai/save-answer', apiError(500, 'INTERNAL'));
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Không lưu được câu trả lời. Thử lại.',
    );
    expect(mock.callsTo('POST /api/ai/save-answer')[0]?.body).toMatchObject({ folder: '0 Inbox' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('the folder choice is styled with tokens: no fieldset box, radio and name apart', async () => {
    await answered(null);
    const radio = screen.getByRole('radio', { name: '0 Inbox' });
    expect(radio.closest('label')).toHaveClass('ai-save__folder');
    expect(radio.closest('fieldset')).toHaveClass('ai-save__folders');
    const css = await readWebSource('features/ai-chat/ai-chat.css');
    const rule = (selector: string) => cssRule(css, selector);
    expect(rule('.ai-save__folders')).toMatch(/border:\s*0/);
    expect(rule('.ai-save__folders')).toMatch(/padding:\s*0/);
    expect(rule('.ai-save__folder')).toMatch(/gap:\s*var\(--space-2\)/);
    expect(rule('.ai-save__folder input')).toMatch(/accent-color:\s*var\(--accent\)/);
    expect(rule('.ai-save__folder input:focus-visible')).toMatch(
      /outline:\s*2px solid var\(--focus\)/,
    );
  });
});
