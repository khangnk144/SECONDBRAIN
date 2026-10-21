import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsResponse } from '../../lib/api/settings-types';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { CONSENT_AT, type StatusExtras } from './ai-settings-test-kit';
import { installSettingsRoutes, renderSettings, settingsResponse } from './settings-test-kit';

let mock: FetchMock;
let extras: StatusExtras;
const puts = () => mock.callsTo('PUT /api/settings').map((call) => call.body);

/** AI on with consent and an Anthropic key; embeddings as given. */
function aiOn(ai: Partial<SettingsResponse['ai']> = {}): SettingsResponse {
  const base = settingsResponse();
  return {
    ...base,
    ai: {
      ...base.ai,
      enabled: true,
      consent: { at: CONSENT_AT, provider: 'anthropic' },
      keys: { ...base.ai.keys, anthropic: { set: true, last4: '…abcd' } },
      ...ai,
    },
  };
}

const embeddingsOn = (ai: Partial<SettingsResponse['ai']> = {}) =>
  aiOn({
    embeddings: true,
    embeddingsConsent: { at: CONSENT_AT, provider: 'openai' },
    keys: {
      anthropic: { set: true, last4: '…abcd' },
      openai: { set: true, last4: '…wxyz' },
      gemini: { set: false, last4: null },
    },
    ...ai,
  });

const embeddingsSwitch = () => screen.findByRole('switch', { name: 'Bật tìm theo nghĩa' });

describe('Settings: search by meaning, a separate opt-in (F33.3, F33.5)', () => {
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
    extras = {};
  });
  afterEach(() => vi.unstubAllGlobals());

  it('has its own consent dialog: what is sent, to whom; "Để sau" sends nothing', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, aiOn(), () => extras);
    renderSettings();
    expect(await screen.findByText('Đang tắt. Tìm kiếm chỉ khớp theo chữ.')).toBeVisible();
    // Its own key field: the chat key (Anthropic) does not serve OpenAI.
    expect(screen.getByLabelText('Khóa API OpenAI')).toHaveAttribute('type', 'password');
    await user.click(await embeddingsSwitch());
    let dialog = await screen.findByRole('dialog', { name: 'Bật tìm theo nghĩa với OpenAI?' });
    expect(dialog).toHaveTextContent(
      'chữ của mọi ghi chú trong các thư mục AI được đọc (Ghi chú ở gốc kho, 0 Inbox, 1 Projects, 2 Areas) được gửi dần tới OpenAI và được xử lý theo chính sách của OpenAI.',
    );
    // Not only search text: questions to AI and the text of link/Inbox suggestions are embedded too.
    expect(dialog).toHaveTextContent(
      'Từ khóa bạn gõ khi tìm kiếm, câu bạn hỏi AI, đoạn chữ bạn chọn khi bấm Gợi ý liên kết và ' +
        'ghi chú Inbox khi bấm Gợi ý chỗ để cũng được gửi tới OpenAI để tìm theo nghĩa.',
    );
    expect(dialog).toHaveTextContent('Mỗi ghi chú tốn một ít token');
    expect(dialog).toHaveTextContent('Bạn tắt được bất cứ lúc nào.');
    await user.click(within(dialog).getByRole('button', { name: 'Để sau' }));
    expect(puts()).toEqual([]);
    expect(await embeddingsSwitch()).not.toBeChecked();

    await user.click(await embeddingsSwitch());
    dialog = await screen.findByRole('dialog', { name: 'Bật tìm theo nghĩa với OpenAI?' });
    await user.click(within(dialog).getByRole('button', { name: 'Đồng ý và bật' }));
    await waitFor(() =>
      expect(puts()).toEqual([{ ai: { embeddings: true, embeddingsConsent: true } }]),
    );
    expect(await embeddingsSwitch()).toBeChecked();
    expect(await screen.findByText('Cần khóa API OpenAI để tạo chỉ mục theo nghĩa.')).toBeVisible();
  });

  it('turning on chat AI never turns on embeddings; a shared provider shares its key', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    await user.click(await screen.findByRole('switch', { name: 'Bật AI trong app' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Đồng ý và bật' }));
    await waitFor(() => expect(puts()).toEqual([{ ai: { enabled: true, consent: true } }]));
    expect(await embeddingsSwitch()).not.toBeChecked();

    await user.selectOptions(screen.getByLabelText('Nhà cung cấp'), 'openai');
    expect(await screen.findByText('Dùng chung khóa API OpenAI ở trên.')).toBeVisible();
    expect(screen.getAllByLabelText(/Khóa API/)).toHaveLength(1);
  });

  it('shows progress, and follows ai:status events at once', async () => {
    extras = { embeddings: { state: 'running', done: 120, total: 400 } };
    installSettingsRoutes(mock, embeddingsOn(), () => extras);
    renderSettings();
    expect(await screen.findByText('Đang tạo chỉ mục theo nghĩa 120/400.')).toBeVisible();
    const bar = screen.getByRole('progressbar', { name: 'Tiến độ tạo chỉ mục theo nghĩa' });
    expect(bar).toHaveAttribute('value', '120');
    act(() =>
      emitServerEvent({
        type: 'ai:status',
        embeddings: { state: 'running', done: 200, total: 400 },
      }),
    );
    expect(screen.getByText('Đang tạo chỉ mục theo nghĩa 200/400.')).toBeVisible();
    expect(bar).toHaveAttribute('value', '200');
    act(() =>
      emitServerEvent({ type: 'ai:status', embeddings: { state: 'idle', done: 400, total: 400 } }),
    );
    expect(screen.getByText('Sẵn sàng.')).toBeVisible();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it.each([
    [{ state: 'error', lastError: 'auth' }, 'Lỗi: khóa API không đúng hoặc đã hết hạn.'],
    [{ state: 'error', lastError: 'quota' }, 'Lỗi: tài khoản OpenAI đã hết tiền hoặc hết hạn mức.'],
    [
      { state: 'queued', lastError: 'network' },
      'Lỗi: không kết nối được với OpenAI. App sẽ tự thử lại sau.',
    ],
    [{ state: 'queued', lastError: null }, 'Đang chờ để tạo chỉ mục theo nghĩa…'],
    [{ state: 'stale', lastError: null }, 'Cần tạo lại vì bạn đổi mô hình.'],
    [{ state: 'off', lastError: 'budget' }, 'Tạm dừng vì hạn mức tháng này không đủ để tạo tiếp.'],
  ] as const)('state %o reads "%s"', async (embeddings, text) => {
    extras = { embeddings };
    installSettingsRoutes(mock, embeddingsOn(), () => extras);
    renderSettings();
    expect(await screen.findByText(new RegExp(`^${text.replace(/[.?]/g, '\\$&')}`))).toBeVisible();
  });

  it('"Tạo lại chỉ mục theo nghĩa" starts a rebuild or says why it cannot', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, embeddingsOn());
    mock.on('POST /api/ai/embeddings/rebuild', { status: 202, body: { started: true } });
    renderSettings();
    const rebuild = await screen.findByRole('button', { name: 'Tạo lại chỉ mục theo nghĩa' });
    await user.click(rebuild);
    expect(await screen.findByText('Đã bắt đầu tạo lại chỉ mục theo nghĩa.')).toBeVisible();
    expect(mock.callsTo('POST /api/ai/embeddings/rebuild')).toHaveLength(1);

    mock.on('POST /api/ai/embeddings/rebuild', { status: 202, body: { started: false } });
    await user.click(rebuild);
    expect(
      await screen.findByText('Chỉ mục đang được tạo. Đợi xong rồi thử lại nhé.'),
    ).toBeVisible();
    mock.on('POST /api/ai/embeddings/rebuild', apiError(409, 'AI_NO_KEY', { reason: 'no-key' }));
    await user.click(rebuild);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cần khóa API OpenAI trước khi tạo chỉ mục.',
    );
    mock.on('POST /api/ai/embeddings/rebuild', apiError(429, 'AI_BUDGET'));
    await user.click(rebuild);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Tháng này đã dùng hết hạn mức.'),
    );
  });

  it('another embedding provider asks for consent again and resets the model', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, embeddingsOn({ embeddingModel: 'text-embedding-3-large' }));
    renderSettings();
    expect(await screen.findByText('Sẵn sàng.')).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Nhà cung cấp cho tìm theo nghĩa'), 'gemini');
    await waitFor(() => expect(puts()).toEqual([{ ai: { embeddingProvider: 'gemini' } }]));
    expect(await screen.findByText('Cần đồng ý lại vì bạn đã đổi nhà cung cấp.')).toBeVisible();
    const model = screen.getByRole('textbox', { name: 'Mô hình embedding' });
    expect(model).toHaveValue('');
    await waitFor(() => expect(model).toHaveAttribute('placeholder', 'gemini-embedding-001'));
    expect(screen.getByLabelText('Khóa API Google Gemini')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Xem và đồng ý' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Bật tìm theo nghĩa với Google Gemini?',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Đồng ý và bật' }));
    await waitFor(() =>
      expect(puts()[1]).toEqual({ ai: { embeddings: true, embeddingsConsent: true } }),
    );
    expect(
      await screen.findByText('Cần khóa API Google Gemini để tạo chỉ mục theo nghĩa.'),
    ).toBeVisible();
  });
});
