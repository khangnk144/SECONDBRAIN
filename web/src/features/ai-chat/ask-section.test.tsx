import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchMock } from '../../lib/testing/fetch-mock';
import { NotePanel } from '../backlinks/note-panel';
import { aiStatus, done, setAiStatus, setUpChat, type ScriptedChat } from './chat-test-kit';

const NOTE = '2 Areas/Giải tích 1.md';
let chat: ScriptedChat;
let mock: FetchMock;

function renderPanel(path = NOTE) {
  const router = createMemoryRouter([{ path: '/note', element: <NotePanel /> }], {
    initialEntries: [`/note?path=${encodeURIComponent(path)}`],
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('note panel "Hỏi" section (F33)', () => {
  beforeEach(async () => {
    ({ chat, mock } = await setUpChat());
    mock.on('GET /api/note', (call) => ({
      body: {
        path: call.query.get('path'),
        content: '# Giải tích 1\n',
        revision: 'r1',
        utf8: true,
        mtime: 0,
        frontmatter: null,
        frontmatterError: null,
        backlinks: [],
        outlinks: [],
        tags: [],
        class: 'user',
      },
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is the first section, collapsed; a question sends the note path', async () => {
    renderPanel();
    const toggles = screen.getAllByRole('button', { expanded: false });
    const ask = screen.getByRole('button', { name: 'Hỏi' });
    expect(ask).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent('Hỏi');
    expect(toggles).toContain(ask);
    expect(screen.queryByRole('textbox')).toBeNull();
    const user = userEvent.setup();
    await user.click(ask);
    // Says what leaves the computer, and to whom.
    expect(screen.getByText(/Hỏi về ghi chú này/)).toHaveTextContent(
      'Câu hỏi của bạn và vài đoạn trích từ ghi chú liên quan được gửi đến Anthropic (Claude) để trả lời.',
    );
    expect(screen.getByText(/Hỏi về ghi chú này/)).not.toHaveTextContent('tìm theo nghĩa');
    await user.type(
      screen.getByRole('textbox', { name: 'Câu hỏi của bạn' }),
      'Chương 2 nói gì?{Enter}',
    );
    await vi.waitFor(() => expect(chat.requests).toHaveLength(1));
    expect(chat.requests[0]).toEqual({ question: 'Chương 2 nói gì?', notePath: NOTE });
    act(() => {
      chat.send(done({ answer: 'Về giới hạn.' }));
      chat.end();
    });
    expect(await screen.findByText('Về giới hạn.')).toBeInTheDocument();
    // Collapsing keeps the conversation of this note.
    await user.click(ask);
    await user.click(ask);
    expect(screen.getByText('Về giới hạn.')).toBeInTheDocument();
  });

  it('searching by meaning: also names the embedding provider the question goes to', async () => {
    setAiStatus(aiStatus({ retrieval: 'hybrid' }));
    renderPanel();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Hỏi' }));
    expect(screen.getByText(/Hỏi về ghi chú này/)).toHaveTextContent(
      'được gửi đến Anthropic (Claude) để trả lời. ' +
        'Câu hỏi cũng được gửi tới OpenAI để tìm theo nghĩa.',
    );
  });

  it('says when the note is outside the folders AI may read', async () => {
    setAiStatus(aiStatus({ scope: ['', '0 Inbox', '1 Projects'] }));
    renderPanel();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Hỏi' }));
    const section = screen.getByRole('region', { name: 'Hỏi' });
    expect(
      within(section).getByText(/^Ghi chú này nằm ngoài các thư mục AI được đọc, nên trợ lý/),
    ).toBeInTheDocument();
  });
});
