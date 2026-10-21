import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChat } from './ai-chat';
import { done, meta, setUpChat, type ScriptedChat } from './chat-test-kit';

const THREAD = 'ask';
let chat: ScriptedChat;

async function ask(question: string) {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'Câu hỏi của bạn' }), `${question}{Enter}`);
  await vi.waitFor(() => expect(chat.requests).toHaveLength(1));
  return user;
}

describe('chat: streaming answers (F33.2)', () => {
  beforeEach(async () => {
    ({ chat } = await setUpChat());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the deltas as plain text, then the validated answer replaces them', async () => {
    render(<AiChat threadId={THREAD} variant="screen" />);
    await ask('Tóm tắt về đạo hàm');
    expect(chat.requests[0]).toEqual({ question: 'Tóm tắt về đạo hàm' });
    expect(await screen.findByText('Đang đọc ghi chú…')).toBeInTheDocument();
    act(() => {
      chat.send(
        meta({ sources: [{ id: 'S1', path: '2 Areas/Đạo hàm.md', title: 'Đạo hàm', page: null }] }),
      );
      chat.send({ type: 'delta', text: 'Đạo hàm là **giới hạn** [S1]' });
    });
    // While it streams: raw text, nothing rendered as Markdown, no link yet.
    expect(await screen.findByText('Đạo hàm là **giới hạn** [S1]')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    act(() => {
      chat.send(
        done({
          answer: 'Đạo hàm là **giới hạn** [[2 Areas/Đạo hàm|Đạo hàm]].',
          citations: [{ path: '2 Areas/Đạo hàm.md', title: 'Đạo hàm', page: null }],
        }),
      );
      chat.end();
    });
    const link = await screen.findByRole('link', { name: 'Đạo hàm' });
    expect(link.closest('p')?.querySelector('strong')).toHaveTextContent('giới hạn');
    expect(screen.queryByText(/\[S1\]/)).toBeNull();
    // The answer is labelled as the AI's and announced once finished.
    expect(screen.getAllByText('Trợ lý AI').length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(screen.getByText('Trợ lý AI đã trả lời.')).toBeInTheDocument());
  });

  it('shows the notices and the sources disclosure with titles and pages', async () => {
    render(<AiChat threadId={THREAD} variant="screen" />);
    const user = await ask('Bài báo nói gì?');
    act(() => {
      chat.send(
        meta({
          sources: [
            { id: 'S1', path: '3 Resources/papers/bài báo.pdf', title: 'bài báo', page: 3 },
            { id: 'S2', path: '2 Areas/Ghi chú.md', title: 'Ghi chú', page: null },
            { id: 'S3', path: '2 Areas/Ghi chú.md', title: 'Ghi chú', page: null },
          ],
        }),
      );
      chat.send(
        done({
          answer: 'Không chắc.',
          notices: ['citation-rejected', 'uncited', 'out-of-scope-hidden', 'empty'],
        }),
      );
      chat.end();
    });
    expect(
      await screen.findByText('Một vài trích dẫn không khớp ghi chú nào nên đã được bỏ.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Câu trả lời này chưa dẫn nguồn, hãy kiểm tra lại.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Một số mục nằm ngoài thư mục AI được đọc nên không được hiện.'),
    ).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Nguồn (2)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(list).not.toBeNull();
    const items = within(list as HTMLElement).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['bài báo, tr. 3', 'Ghi chú']);
  });

  it('a structured answer says it comes from Today instead of listing sources', async () => {
    render(<AiChat threadId={THREAD} variant="screen" />);
    await ask('Tuần này có gì đến hạn?');
    act(() => {
      chat.send(meta({ kind: 'deadlines', retrieval: 'structured' }));
      chat.send(
        done({
          answer: '**Thứ Sáu, 23/10**\n- [[1 Projects/Đồ án|Đồ án]]',
          citations: [{ path: '1 Projects/Đồ án.md', title: 'Đồ án', page: null }],
        }),
      );
      chat.end();
    });
    expect(await screen.findByText('Lấy từ trang Hôm nay')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nguồn/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Đồ án' }).closest('li')).not.toBeNull();
    // A list row's link is the item's note, not a citation in parentheses.
    expect(screen.getByRole('link', { name: 'Đồ án' }).closest('.ai-answer__cite')).toBeNull();
  });

  it('citations read as sources in parentheses, apart from the sentence', async () => {
    render(<AiChat threadId={THREAD} variant="screen" />);
    await ask('Công thức Bayes dùng để làm gì?');
    const pdf = '3 Resources/papers/bài báo.pdf';
    act(() => {
      chat.send(
        meta({
          sources: [
            {
              id: 'S1',
              path: '2 Areas/Xác suất thống kê.md',
              title: 'Xác suất thống kê',
              page: null,
            },
            { id: 'S2', path: '2 Areas/Bayes.md', title: 'Bayes', page: null },
            { id: 'S3', path: pdf, title: 'bài báo', page: 3 },
          ],
        }),
      );
      chat.send(
        done({
          answer:
            'Bayes cập nhật xác suất khi có thông tin mới [[2 Areas/Xác suất thống kê|Xác suất thống kê]], ' +
            '[[2 Areas/Bayes|Bayes]]. Có ví dụ về lọc thư rác [[bài báo.pdf]] (tr. 3).',
          citations: [
            { path: '2 Areas/Xác suất thống kê.md', title: 'Xác suất thống kê', page: null },
            { path: '2 Areas/Bayes.md', title: 'Bayes', page: null },
            { path: pdf, title: 'bài báo', page: 3 },
          ],
        }),
      );
      chat.end();
    });
    const first = await screen.findByRole('link', { name: 'Xác suất thống kê' });
    expect(first.closest('p')).toHaveTextContent(
      'Bayes cập nhật xác suất khi có thông tin mới (Xác suất thống kê; Bayes). ' +
        'Có ví dụ về lọc thư rác (bài báo.pdf, tr. 3).',
    );
    const groups = document.querySelectorAll('.ai-answer .ai-answer__cite');
    expect(groups).toHaveLength(2);
    expect(within(groups[0] as HTMLElement).getAllByRole('link')).toHaveLength(2);
    expect(
      within(groups[1] as HTMLElement).getByRole('link', { name: 'bài báo.pdf' }),
    ).toBeVisible();
  });

  it.each([
    ['nothing found', meta(), 'Không tìm thấy ghi chú nào nói về điều này.', 'empty'],
    [
      'no item in the range',
      meta({ kind: 'deadlines', retrieval: 'structured' }),
      'Không có deadline nào còn mở từ 19/10 đến 25/10.',
      'no-items',
    ],
  ] as const)(
    '%s: the app’s own sentence is not labelled as the AI’s and offers no save',
    async (_case, metaEvent, sentence, notice) => {
      render(<AiChat threadId={THREAD} variant="screen" />);
      await ask('Có gì về điều này?');
      act(() => {
        chat.send(metaEvent);
        chat.send({ type: 'delta', text: sentence });
        chat.send(done({ answer: sentence, notices: [notice] }));
        chat.end();
      });
      const answer = await screen.findByText(sentence, { selector: '.ai-answer p' });
      const turn = answer.closest('li') as HTMLElement;
      expect(within(turn).queryByText('Trợ lý AI')).toBeNull();
      expect(within(turn).getByText('Thông báo của app')).toHaveClass('visually-hidden');
      expect(within(turn).queryByRole('button', { name: 'Lưu thành ghi chú' })).toBeNull();
      // Read out as it is, not as "the AI assistant answered".
      await vi.waitFor(() =>
        expect(screen.getByText(sentence, { selector: '[aria-live]' })).toBeInTheDocument(),
      );
      expect(screen.queryByText('Trợ lý AI đã trả lời.')).toBeNull();
    },
  );

  it('"Dừng" aborts the request and keeps the text so far, marked as stopped', async () => {
    render(<AiChat threadId={THREAD} variant="screen" />);
    const user = await ask('Giải thích ma trận');
    act(() => chat.send({ type: 'delta', text: 'Ma trận là' }));
    await screen.findByText('Ma trận là');
    await user.click(screen.getByRole('button', { name: 'Dừng' }));
    expect(chat.signals[0]?.aborted).toBe(true);
    expect(await screen.findByText('Đã dừng.', { selector: '.ai-chat__note' })).toBeInTheDocument();
    expect(screen.getByText('Ma trận là')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hỏi' })).toBeInTheDocument();
  });

  it('sends the earlier finished turns as history and starts over on "Cuộc trò chuyện mới"', async () => {
    render(<AiChat threadId={THREAD} variant="screen" />);
    const user = await ask('Câu một');
    act(() => {
      chat.send(done({ answer: 'Đáp một' }));
      chat.end();
    });
    await screen.findByText('Đáp một');
    const input = screen.getByRole('textbox', { name: 'Câu hỏi của bạn' });
    await user.type(input, 'Câu hai{Enter}');
    await vi.waitFor(() => expect(chat.requests).toHaveLength(2));
    expect(chat.requests[1]?.history).toEqual([
      { role: 'user', content: 'Câu một' },
      { role: 'assistant', content: 'Đáp một' },
    ]);
    act(() => chat.end());
    await user.click(await screen.findByRole('button', { name: 'Cuộc trò chuyện mới' }));
    expect(screen.queryByText('Câu một')).toBeNull();
    expect(input).toHaveFocus();
  });
});
