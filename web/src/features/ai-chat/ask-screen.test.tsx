import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarNav } from '../../app/sidebar-nav';
import { setAppNavigator } from '../../lib/app-navigation';
import { APP_COMMANDS } from '../../lib/commands/command-registry';
import { AskScreen } from './ask-screen';
import { aiStatus, done, meta, setAiStatus, setUpChat, type ScriptedChat } from './chat-test-kit';

let chat: ScriptedChat;
const input = () => screen.getByRole('textbox', { name: 'Câu hỏi của bạn' });

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <SidebarNav /> },
      { path: '/ask', element: <AskScreen /> },
    ],
    { initialEntries: [path] },
  );
  setAppNavigator((to, options) => void router.navigate(to, options));
  render(<RouterProvider router={router} />);
  return router;
}

describe('Ask screen "Hỏi ghi chú của bạn" (F33, S5)', () => {
  beforeEach(async () => {
    ({ chat } = await setUpChat());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starters fill the box with the caret at the end, without sending', async () => {
    renderAt('/ask');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Hỏi ghi chú của bạn' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Tìm theo từ khóa \(BM25\)\./)).toBeInTheDocument();
    const starters = within(screen.getByRole('group', { name: 'Gợi ý câu hỏi' }));
    const user = userEvent.setup();
    await user.click(starters.getByRole('button', { name: 'Tuần này có gì đến hạn?' }));
    expect(input()).toHaveValue('Tuần này có gì đến hạn?');
    expect(input()).toHaveFocus();
    await user.click(starters.getByRole('button', { name: 'Tóm tắt những gì mình đã ghi về …' }));
    const box = input() as HTMLTextAreaElement;
    expect(box.value).toBe('Tóm tắt những gì mình đã ghi về ');
    expect(box.selectionStart).toBe(box.value.length);
    await user.keyboard('ma trận{Enter}');
    await vi.waitFor(() => expect(chat.requests).toHaveLength(1));
    expect(chat.requests[0]?.question).toBe('Tóm tắt những gì mình đã ghi về ma trận');
    expect(screen.queryByRole('group', { name: 'Gợi ý câu hỏi' })).toBeNull();
  });

  it('labels hybrid search "theo nghĩa"; hides starters while AI is not ready', async () => {
    setAiStatus(aiStatus({ retrieval: 'hybrid' }));
    const { unmount } = render(<AskScreen />);
    expect(screen.getByText(/Tìm theo từ khóa và theo nghĩa\./)).toBeInTheDocument();
    // In hybrid mode the question also goes to the embedding provider, and the screen says so.
    expect(screen.getByText(/Tìm theo từ khóa và theo nghĩa\./)).toHaveTextContent(
      'được gửi đến Anthropic (Claude) để trả lời. ' +
        'Câu hỏi cũng được gửi tới OpenAI để tìm theo nghĩa.',
    );
    unmount();
    setAiStatus(aiStatus({ ready: false, reason: 'disabled', enabled: false }));
    render(<AskScreen />);
    expect(screen.queryByRole('group', { name: 'Gợi ý câu hỏi' })).toBeNull();
    expect(screen.queryByText(/Tìm theo từ khóa/)).toBeNull();
  });

  it('keyboard only: Tab to the box, type, Enter, then reach the links and buttons', async () => {
    renderAt('/ask');
    const user = userEvent.setup();
    for (let i = 0; i < 3; i += 1) await user.tab();
    await user.tab();
    expect(input()).toHaveFocus();
    await user.keyboard('Tuần này có gì đến hạn?{Enter}');
    await vi.waitFor(() => expect(chat.requests).toHaveLength(1));
    expect(input()).toHaveFocus();
    act(() => {
      chat.send(
        meta({
          kind: 'text',
          sources: [{ id: 'S1', path: '1 Projects/Đồ án.md', title: 'Đồ án', page: null }],
        }),
      );
      chat.send(
        done({
          answer: 'Có [[1 Projects/Đồ án|Đồ án]].',
          citations: [{ path: '1 Projects/Đồ án.md', title: 'Đồ án', page: null }],
        }),
      );
      chat.end();
    });
    await screen.findByRole('link', { name: 'Đồ án' });
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Lưu thành ghi chú' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Nguồn (1)' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('link', { name: 'Đồ án' })).toHaveFocus();
    for (let i = 0; i < 3; i += 1) await user.tab();
    expect(input()).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Hỏi' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cuộc trò chuyện mới' })).toHaveFocus();
  });

  it('the palette command "Hỏi AI…" opens the screen with focus in the box', async () => {
    renderAt('/');
    const command = APP_COMMANDS.find((candidate) => candidate.id === 'ask-ai');
    expect(command?.feature).toBe('ai');
    act(() => command?.run());
    expect(await screen.findByRole('heading', { name: 'Hỏi ghi chú của bạn' })).toBeInTheDocument();
    await vi.waitFor(() => expect(input()).toHaveFocus());
  });

  it('the sidebar lists "Hỏi AI" right below "Bản đồ não"', () => {
    renderAt('/');
    const names = screen.getAllByRole('link').map((link) => link.textContent);
    const graph = names.indexOf('Bản đồ não');
    expect(graph).toBeGreaterThan(-1);
    expect(names[graph + 1]).toBe('Hỏi AI');
    expect(screen.getByRole('link', { name: 'Hỏi AI' })).toHaveAttribute('href', '/ask');
  });
});
