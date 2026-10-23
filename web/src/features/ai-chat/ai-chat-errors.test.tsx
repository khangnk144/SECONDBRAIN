import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Navigator } from '../../lib/app-navigation';
import { setAppNavigator } from '../../lib/app-navigation';
import type { FetchMock } from '../../lib/testing/fetch-mock';
import { AiChat } from './ai-chat';
import { askQuestion } from './chat-send';
import { getThread } from './chat-store';
import { aiStatus, done, setUpChat, type ScriptedChat } from './chat-test-kit';

const THREAD = 'ask';
let chat: ScriptedChat;
let mock: FetchMock;

async function ask(question: string) {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'Câu hỏi của bạn' }), `${question}{Enter}`);
  await vi.waitFor(() => expect(chat.requests.length).toBeGreaterThan(0));
  return user;
}

describe('chat: AI not ready sends nothing (F33.3)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['disabled', 'AI chưa bật. Bạn bật được trong Cài đặt, mục AI.'],
    // The switch is still on after a provider change: only the consent for it is missing.
    ['no-consent', 'Bạn vừa đổi nhà cung cấp AI. Mở Cài đặt, mục AI, bấm Xem và đồng ý.'],
    [
      'budget',
      'Đã dùng hết hạn mức tháng này (2.000.000 token). Tăng hạn mức trong Cài đặt hoặc chờ sang tháng.',
    ],
  ] as const)('%s: explains, offers Settings, has no input', async (reason, text) => {
    const paused = reason === 'budget';
    const status = aiStatus({
      ready: false,
      reason,
      enabled: reason !== 'disabled',
      usage: { month: '2026-10', tokens: 2_000_000, limit: 2_000_000, paused },
    });
    ({ chat, mock } = await setUpChat(status));
    const navigate = vi.fn<Navigator>();
    setAppNavigator(navigate);
    render(<AiChat threadId={THREAD} variant="panel" />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    await askQuestion(THREAD, 'Có gì đến hạn?');
    expect(chat.requests).toHaveLength(0);
    // Settings is not rendered here: a stand-in for its AI heading lets the opener finish (its
    // 3 s wait for the section would otherwise outlive this file's document).
    const heading = document.createElement('h2');
    heading.id = 'settings-ai';
    document.body.append(heading);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Mở Cài đặt AI' }));
    expect(navigate).toHaveBeenCalledWith('/settings', undefined);
    await waitFor(() => expect(heading).toHaveFocus());
    heading.remove();
  });

  it('no key: route B needs a key, route A goes through Claude Desktop', async () => {
    ({ chat, mock } = await setUpChat(aiStatus({ ready: false, reason: 'no-key', hasKey: false })));
    render(<AiChat threadId={THREAD} variant="panel" />);
    expect(
      screen.getByText(
        'Để hỏi ngay trong app, AI cần một khóa API của Anthropic (Claude), OpenAI hoặc Google Gemini, nhập trong Cài đặt, mục AI.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Dùng tài khoản Claude của bạn qua Claude Desktop: xem mục Kết nối Claude trong Cài đặt.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mở Kết nối Claude' })).toBeInTheDocument();
    await askQuestion(THREAD, 'Xin chào');
    expect(chat.requests).toHaveLength(0);
  });

  it('an unknown status is asked for first; not ready → nothing sent, the text is kept', async () => {
    ({ chat, mock } = await setUpChat(null));
    mock.on('GET /api/ai/status', { body: aiStatus({ ready: false, reason: 'disabled' }) });
    render(<AiChat threadId={THREAD} variant="panel" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Câu hỏi của bạn' }), 'Xin chào{Enter}');
    expect(
      await screen.findByText('AI chưa bật. Bạn bật được trong Cài đặt, mục AI.'),
    ).toBeInTheDocument();
    expect(mock.callsTo('GET /api/ai/status')).toHaveLength(1);
    expect(chat.requests).toHaveLength(0);
    expect(getThread(THREAD).draft).toBe('Xin chào');
  });

  it('a refusal before the stream reloads the status and shows the notice', async () => {
    ({ chat, mock } = await setUpChat());
    render(<AiChat threadId={THREAD} variant="panel" />);
    chat.refuseNext(409, 'AI_NO_KEY', { reason: 'no-key' });
    mock.on('GET /api/ai/status', { body: aiStatus({ ready: false, reason: 'no-key' }) });
    await ask('Có gì mới?');
    expect(await screen.findByRole('alert')).toHaveTextContent(/AI cần một khóa API/);
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    await vi.waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  it('a missing consent refused before the stream says the provider changed', async () => {
    ({ chat, mock } = await setUpChat());
    render(<AiChat threadId={THREAD} variant="panel" />);
    chat.refuseNext(409, 'AI_DISABLED', { reason: 'no-consent' });
    mock.on('GET /api/ai/status', { body: aiStatus({ ready: false, reason: 'no-consent' }) });
    await ask('Có gì mới?');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Bạn vừa đổi nhà cung cấp AI. Mở Cài đặt, mục AI, bấm Xem và đồng ý.',
    );
    const turn = alert.closest('li') as HTMLElement;
    expect(within(turn).getByRole('button', { name: 'Mở Cài đặt AI' })).toBeInTheDocument();
  });
});

describe('chat: provider errors say what happened, "Thử lại" asks again', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['network', 'Không kết nối được với Anthropic (Claude). Kiểm tra mạng rồi thử lại.'],
    ['auth', 'Khóa API không đúng hoặc đã hết hạn. Kiểm tra lại trong Cài đặt.'],
    ['rate-limit', 'Anthropic (Claude) đang nhận quá nhiều yêu cầu. Đợi một chút rồi thử lại.'],
    ['quota', /Tài khoản Anthropic \(Claude\) đã hết hạn mức hoặc hết tiền nạp/],
    ['timeout', /Anthropic \(Claude\) trả lời quá lâu/],
    ['server', 'Anthropic (Claude) đang gặp sự cố. Thử lại sau ít phút.'],
    ['malformed', 'Câu trả lời từ Anthropic (Claude) bị ngắt giữa chừng. Thử lại.'],
  ] as const)('%s', async (reason, text) => {
    ({ chat, mock } = await setUpChat());
    render(<AiChat threadId={THREAD} variant="panel" />);
    const user = await ask('Câu hỏi');
    // The stream's error event carries the reason in its message (no details on the wire).
    act(() => {
      chat.send({
        type: 'error',
        code: 'AI_PROVIDER_ERROR',
        message: `The AI provider failed (${reason}).`,
      });
      chat.end();
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    // The app's own words: not labelled as the AI's, nothing to save as a note.
    expect(screen.queryByText('Trợ lý AI')).toBeNull();
    expect(screen.getByText('Thông báo của app')).toHaveClass('visually-hidden');
    expect(screen.queryByRole('button', { name: 'Lưu thành ghi chú' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mở Cài đặt AI' }) !== null).toBe(
      reason === 'auth',
    );
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    await vi.waitFor(() => expect(chat.requests).toHaveLength(2));
    expect(chat.requests[1]).toEqual({ question: 'Câu hỏi' });
    act(() => {
      chat.send(done({ answer: 'Đã ổn.' }));
      chat.end();
    });
    expect(await screen.findByText('Đã ổn.')).toBeInTheDocument();
    expect(screen.getByText('Trợ lý AI')).toBeInTheDocument();
    // The failed turn was replaced, not kept beside the new answer.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByText('Câu hỏi')).toHaveLength(1);
  });

  it('a provider error refused before the stream uses its details', async () => {
    ({ chat, mock } = await setUpChat(aiStatus({ provider: 'gemini' })));
    render(<AiChat threadId={THREAD} variant="panel" />);
    chat.refuseNext(502, 'AI_PROVIDER_ERROR', { reason: 'network', status: null });
    await ask('Một');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Không kết nối được với Google Gemini. Kiểm tra mạng rồi thử lại.',
    );
  });

  it('the app server out of reach is said as such', async () => {
    ({ chat, mock } = await setUpChat());
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    render(<AiChat threadId={THREAD} variant="panel" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Câu hỏi của bạn' }), 'Ba{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Không kết nối được với máy chủ của app. Kiểm tra Second Brain đang chạy rồi thử lại.',
    );
  });

  it('a stream that ends without an answer is reported as cut off', async () => {
    ({ chat, mock } = await setUpChat());
    render(<AiChat threadId={THREAD} variant="panel" />);
    await ask('Hai');
    act(() => {
      chat.send({ type: 'delta', text: 'Một nửa' });
      chat.end();
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Câu trả lời bị ngắt giữa chừng. Thử lại.',
    );
  });
});
