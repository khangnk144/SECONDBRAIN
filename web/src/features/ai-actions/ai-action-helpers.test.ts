import { beforeAll, describe, expect, it } from 'vitest';
import { i18n, initI18n } from '../../i18n';
import { ApiError } from '../../lib/api-client';
import type { AiStatus } from '../../lib/api/ai-types';
import { isInAiScope } from '../../lib/ai-status-store';
import { aiErrorView, EMPTY_ANSWER } from './ai-error-message';
import { aiBlocker } from './ai-readiness';
import { aiQuoteMarkdown } from './apply-ai-result';
import { wordDiff } from './word-diff';
import { readyStatus } from './ai-actions-test-kit';

beforeAll(() => {
  initI18n('vi');
});

const t = (key: string, values?: Record<string, string>) => i18n.t(key, values);
const message = (error: unknown, status: AiStatus | null = readyStatus()) => {
  const view = aiErrorView(error, status, t, 'vi');
  return { text: t(view.key, view.values), retry: view.retry, settings: view.settings };
};

describe('AI readiness before anything is sent (F33.3)', () => {
  it('blocks when the status is unknown, AI is not ready, or the note is out of scope', () => {
    expect(aiBlocker(null, '0 Inbox/a.md')).toBe('unavailable');
    expect(aiBlocker({ ...readyStatus(), available: false }, null)).toBe('unavailable');
    for (const reason of ['disabled', 'no-consent', 'no-key', 'budget'] as const) {
      expect(aiBlocker({ ...readyStatus(), ready: false, reason }, '0 Inbox/a.md')).toBe(reason);
    }
    expect(aiBlocker(readyStatus(), '3 Resources/papers/x.md')).toBe('out-of-scope');
    expect(aiBlocker(readyStatus(), '1 Projects/Đồ án/Kế hoạch.md')).toBeNull();
  });

  it('scope follows the server: root notes, folders and their subfolders, never templates or control docs', () => {
    const status = readyStatus();
    expect(isInAiScope(status, 'Ghi chú gốc.md')).toBe(true);
    expect(isInAiScope(status, '0 INBOX/a.md')).toBe(true);
    expect(isInAiScope(status, 'CLAUDE.md')).toBe(false);
    expect(isInAiScope(status, 'wiki/log.md')).toBe(false);
    expect(isInAiScope(status, 'wiki/index.md')).toBe(true);
    expect(isInAiScope({ ...status, scope: ['', 'Templates'] }, 'Templates/Paper.md')).toBe(false);
    const narrow = { ...status, scope: ['1 Projects/Đồ án'] };
    expect(isInAiScope(narrow, '1 Projects/Đồ án/Kế hoạch.md')).toBe(true);
    expect(isInAiScope(narrow, '1 Projects/Khác.md')).toBe(false);
    expect(isInAiScope(narrow, 'Ghi chú gốc.md')).toBe(false);
  });
});

describe('AI error messages say what happened and what to do', () => {
  it('names the provider and offers the right next step per reason', () => {
    const provider = (reason: string) =>
      new ApiError(502, 'AI_PROVIDER_ERROR', 'x', { reason, status: 0 });
    expect(message(provider('network'))).toEqual({
      text: 'Không kết nối được với Anthropic (Claude). Kiểm tra mạng rồi thử lại.',
      retry: true,
      settings: false,
    });
    expect(message(provider('auth'))).toMatchObject({ retry: false, settings: true });
    expect(message(provider('quota')).text).toContain('Tài khoản Anthropic (Claude)');
    // The same display names as Settings, from one place.
    expect(message(provider('server'), { ...readyStatus(), provider: 'gemini' }).text).toBe(
      'Google Gemini đang gặp lỗi. Thử lại sau ít phút.',
    );
    expect(message(provider('malformed')).text).toContain('không đúng dạng');
    expect(message(provider('invalid-answer')).text).toContain('đã bỏ');
  });

  it('readiness refusals use the same sentences as the checks before sending', () => {
    const budget = {
      ...readyStatus(),
      usage: { month: '2026-10', tokens: 9, limit: 2_000_000, paused: true },
    };
    expect(message(new ApiError(429, 'AI_BUDGET', 'x'), budget).text).toBe(
      'Đã dùng hết hạn mức tháng này (2.000.000 token). Tăng hạn mức trong Cài đặt hoặc chờ sang tháng.',
    );
    expect(message(new ApiError(409, 'AI_DISABLED', 'x'))).toMatchObject({ settings: true });
    // A missing consent after a provider change says so, not "AI chưa bật".
    expect(message(new ApiError(409, 'AI_DISABLED', 'x', { reason: 'no-consent' }))).toMatchObject({
      text: 'Bạn vừa đổi nhà cung cấp AI. Mở Cài đặt, mục AI, bấm Xem và đồng ý.',
      settings: true,
      retry: false,
    });
    const outOfScope = new ApiError(400, 'VALIDATION', 'x', { reason: 'out-of-scope' });
    expect(message(outOfScope).text).toContain('ngoài thư mục AI được đọc');
    expect(message(new ApiError(400, 'VALIDATION', 'x', { reason: 'not-in-inbox' })).retry).toBe(
      false,
    );
    expect(message(new TypeError('Failed to fetch')).text).toContain('Chưa kết nối với máy chủ');
    expect(message(EMPTY_ANSWER).retry).toBe(true);
  });
});

describe('AI text in the note is marked as AI’s', () => {
  it('quotes the text under its label; a list starts on its own line', () => {
    expect(aiQuoteMarkdown('Tóm tắt (AI):', 'Ý chính.\n\nCâu hai.')).toBe(
      '> **Tóm tắt (AI):** Ý chính.\n>\n> Câu hai.',
    );
    expect(aiQuoteMarkdown('Giải thích (AI):', '- một\n- hai')).toBe(
      '> **Giải thích (AI):**\n>\n> - một\n> - hai',
    );
  });
});

describe('word diff of a rewrite', () => {
  it('marks removed and added words and keeps the rest', () => {
    expect(wordDiff('Hôm nay mình học bài', 'Hôm nay tôi học bài kỹ')).toEqual([
      { kind: 'same', text: 'Hôm nay ' },
      { kind: 'removed', text: 'mình ' },
      { kind: 'added', text: 'tôi ' },
      { kind: 'same', text: 'học bài ' },
      { kind: 'added', text: 'kỹ' },
    ]);
    expect(wordDiff('', 'mới')).toEqual([{ kind: 'added', text: 'mới' }]);
  });
});
