import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsResponse } from '../../lib/api/settings-types';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { CONSENT_AT, type StatusExtras } from './ai-settings-test-kit';
import { installSettingsRoutes, renderSettings, settingsResponse } from './settings-test-kit';

let mock: FetchMock;
let extras: StatusExtras;
const puts = () => mock.callsTo('PUT /api/settings').map((call) => call.body);

function withAi(ai: Partial<SettingsResponse['ai']>): SettingsResponse {
  const base = settingsResponse();
  return { ...base, ai: { ...base.ai, ...ai } };
}

const KEYS_SET = {
  anthropic: { set: true, last4: '…abcd' },
  openai: { set: true, last4: '…wxyz' },
  gemini: { set: false, last4: null },
};

async function openConsent(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('switch', { name: 'Bật AI trong app' }));
  return screen.findByRole('dialog', { name: 'Bật AI với Anthropic (Claude)?' });
}

describe('Settings AI: consent, status, limit (F33 consent and scope)', () => {
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
    extras = {};
  });
  afterEach(() => vi.unstubAllGlobals());

  it('turning AI on shows what goes to which provider, and nothing is saved before agreeing', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse(), () => extras);
    renderSettings();
    expect(await screen.findByText('AI đang tắt. App không gửi gì đi.')).toBeVisible();
    const dialog = await openConsent(user);
    expect(dialog).toHaveTextContent(
      'được gửi tới Anthropic (Claude) và được xử lý theo chính sách của Anthropic (Claude).',
    );
    const sent = within(within(dialog).getByRole('region', { name: 'Được gửi đi' })).getAllByRole(
      'listitem',
    );
    // Never more than is true: no fixed count of excerpts; the conversation so far, the tag
    // list and a whole Inbox note are named too.
    expect(sent.map((item) => item.textContent)).toEqual([
      'Câu bạn hỏi, cùng các câu hỏi và câu trả lời trước đó trong cùng cuộc trò chuyện.',
      'Vài đoạn trích từ ghi chú liên quan trong các thư mục: Ghi chú ở gốc kho, 0 Inbox, 1 Projects, 2 Areas.',
      'Tên các môn học, đồ án và việc sắp đến hạn trong các thư mục đó.',
      'Đoạn chữ bạn bôi đen khi dùng một thao tác AI. Khi gợi ý thẻ, kèm danh sách thẻ bạn đang dùng.',
      'Cả ghi chú Inbox khi bạn bấm Gợi ý chỗ để, cùng tên các thư mục và tên vài ghi chú liên quan.',
    ]);
    const never = within(dialog).getByRole('region', { name: 'Không bao giờ gửi' });
    expect(
      within(never)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Ghi chú ngoài các thư mục đã chọn.',
      '3 Resources và 4 Archive, trừ khi bạn thêm vào danh sách thư mục.',
      'Tệp đính kèm như ảnh hay PDF. Chữ trong PDF chỉ được trích khi PDF nằm trong thư mục đã chọn.',
      'Khóa API của bạn, trừ cho chính Anthropic (Claude).',
    ]);
    expect(dialog).toHaveTextContent('Hạn mức tháng: 2.000.000 token.');
    expect(dialog).toHaveTextContent(
      'AI có thể trả lời sai. Câu trả lời dẫn về ghi chú khi có thể; hãy kiểm tra lại.',
    );
    expect(dialog).not.toHaveTextContent('luôn dẫn');
    expect(puts()).toEqual([]);
    expect(screen.getByRole('switch', { name: 'Bật AI trong app' })).not.toBeChecked();
  });

  it('the consent dialog opens at its title: focus on "Để sau" without scrolling to it', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse(), () => extras);
    renderSettings();
    const switchControl = await screen.findByRole('switch', { name: 'Bật AI trong app' });
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    // A tall dialog on a small screen scrolls inside itself; whatever it had scrolled is reset.
    const scrollTop = vi.spyOn(Element.prototype, 'scrollTop', 'set');
    try {
      await user.click(switchControl);
      const dialog = await screen.findByRole('dialog', { name: 'Bật AI với Anthropic (Claude)?' });
      const later = within(dialog).getByRole('button', { name: 'Để sau' });
      expect(later).toHaveFocus();
      const call = focus.mock.contexts.findIndex((element) => element === later);
      expect(focus.mock.calls[call]).toEqual([{ preventScroll: true }]);
      expect(scrollTop.mock.contexts).toContain(dialog);
      expect(scrollTop.mock.calls.at(-1)).toEqual([0]);
    } finally {
      focus.mockRestore();
      scrollTop.mockRestore();
    }
  });

  it('"Để sau" leaves AI off; only "Đồng ý và bật" turns it on, with consent', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, withAi({ folders: ['0 Inbox', '3 Resources'] }), () => extras);
    renderSettings();
    let dialog = await openConsent(user);
    // A folder she added is no longer "never sent".
    expect(dialog).toHaveTextContent('các thư mục: 0 Inbox, 3 Resources.');
    expect(dialog).toHaveTextContent('4 Archive, trừ khi bạn thêm vào danh sách thư mục.');
    expect(dialog).not.toHaveTextContent('3 Resources và');
    await user.click(within(dialog).getByRole('button', { name: 'Để sau' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Bật AI trong app' })).not.toBeChecked();
    expect(puts()).toEqual([]);

    dialog = await openConsent(user);
    await user.click(within(dialog).getByRole('button', { name: 'Đồng ý và bật' }));
    await waitFor(() => expect(puts()).toEqual([{ ai: { enabled: true, consent: true } }]));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Bật AI trong app' })).toBeChecked();
    expect(
      await screen.findByText(
        'AI đã bật nhưng chưa có khóa API Anthropic (Claude). Dán khóa vào ô bên dưới nhé.',
      ),
    ).toBeVisible();
    await user.type(
      screen.getByLabelText('Khóa API Anthropic (Claude)'),
      'sk-ant-1234567890abcd{Enter}',
    );
    expect(
      await screen.findByText('AI đang bật với Anthropic (Claude), mô hình claude-haiku-5-5.'),
    ).toBeVisible();

    // Off saves at once, no dialog.
    await user.click(screen.getByRole('switch', { name: 'Bật AI trong app' }));
    await waitFor(() => expect(puts().at(-1)).toEqual({ ai: { enabled: false } }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a refused consent says why and keeps the dialog open', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    const dialog = await openConsent(user);
    mock.on(
      'PUT /api/settings',
      apiError(400, 'VALIDATION', { field: 'ai.enabled', reason: 'consent-required' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Đồng ý và bật' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Cần bạn đồng ý trước khi bật.',
    );
    expect(screen.getByRole('switch', { name: 'Bật AI trong app' })).not.toBeChecked();
  });

  it('a provider change while on asks for consent again, for the new provider', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(
      mock,
      withAi({
        enabled: true,
        consent: { at: CONSENT_AT, provider: 'anthropic' },
        keys: KEYS_SET,
        chatModel: 'claude-x',
      }),
    );
    renderSettings();
    expect(
      await screen.findByText('AI đang bật với Anthropic (Claude), mô hình claude-x.'),
    ).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Nhà cung cấp'), 'openai');
    await waitFor(() => expect(puts()).toEqual([{ ai: { provider: 'openai' } }]));
    expect(await screen.findByText('Cần đồng ý lại vì bạn đã đổi nhà cung cấp.')).toBeVisible();
    // The old provider's model is gone; the new default shows as the placeholder.
    const model = screen.getByRole('textbox', { name: 'Mô hình trò chuyện' });
    await waitFor(() => expect(model).toHaveAttribute('placeholder', 'gpt-5-mini'));
    expect(model).toHaveValue('');
    expect(screen.getByText('Để trống để dùng mô hình mặc định (gpt-5-mini).')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Xem và đồng ý' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bật AI với OpenAI?' });
    expect(dialog).toHaveTextContent('theo chính sách của OpenAI.');
    await user.click(within(dialog).getByRole('button', { name: 'Đồng ý và bật' }));
    await waitFor(() => expect(puts()[1]).toEqual({ ai: { enabled: true, consent: true } }));
    expect(await screen.findByText('AI đang bật với OpenAI, mô hình gpt-5-mini.')).toBeVisible();
  });

  it('the dialog works from the keyboard: focus starts on "Để sau", stays inside, Esc returns it', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    const toggle = await screen.findByRole('switch', { name: 'Bật AI trong app' });
    toggle.focus();
    await user.keyboard(' ');
    const dialog = await screen.findByRole('dialog', { name: 'Bật AI với Anthropic (Claude)?' });
    const later = within(dialog).getByRole('button', { name: 'Để sau' });
    const agree = within(dialog).getByRole('button', { name: 'Đồng ý và bật' });
    expect(later).toHaveFocus();
    await user.tab();
    expect(agree).toHaveFocus();
    await user.tab();
    expect(later).toHaveFocus();
    await user.tab({ shift: true });
    expect(agree).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(toggle).toHaveFocus();
    expect(puts()).toEqual([]);

    await user.keyboard(' ');
    await screen.findByRole('dialog');
    await user.tab();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(puts()).toEqual([{ ai: { enabled: true, consent: true } }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toggle).toHaveFocus();
  });

  it("the monthly limit: whole numbers in range only, this month's use, the pause and how to go on", async () => {
    const user = userEvent.setup();
    extras = { tokens: 1530 };
    installSettingsRoutes(mock, settingsResponse(), () => extras);
    renderSettings();
    const field = await screen.findByRole('textbox', { name: 'Hạn mức mỗi tháng (token)' });
    expect(field).toHaveValue('2.000.000');
    expect(await screen.findByText('Tháng này đã dùng 1.530 / 2.000.000 token.')).toBeVisible();
    expect(
      screen.getByText(/Token là đơn vị nhà cung cấp dùng để đếm chữ và tính phí/),
    ).toBeVisible();

    await user.clear(field);
    await user.type(field, '5000{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Hạn mức cần là số nguyên từ 10.000 đến 100.000.000 token.',
    );
    expect(field).toHaveAttribute('aria-invalid', 'true');
    await user.keyboard('{Escape}');
    expect(field).toHaveValue('2.000.000');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.clear(field);
    await user.type(field, '12,5{Enter}');
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(puts()).toEqual([]);

    extras = { tokens: 3_000_000 };
    await user.clear(field);
    await user.type(field, '3.000.000{Enter}');
    await waitFor(() => expect(puts()).toEqual([{ ai: { monthlyTokenLimit: 3_000_000 } }]));
    expect(await screen.findByRole('textbox', { name: 'Hạn mức mỗi tháng (token)' })).toHaveValue(
      '3.000.000',
    );
    expect(
      await screen.findByText(
        'AI đang tạm dừng vì tháng này đã dùng hết 3.000.000 token. Muốn dùng tiếp, tăng hạn mức ở trên hoặc chờ đến tháng 11 năm 2026.',
      ),
    ).toBeVisible();
  });

  it('the status line names a budget pause; a key is never rendered in full', async () => {
    extras = { tokens: 2_000_000 };
    installSettingsRoutes(
      mock,
      withAi({ enabled: true, consent: { at: CONSENT_AT, provider: 'anthropic' }, keys: KEYS_SET }),
      () => extras,
    );
    renderSettings();
    expect(
      await screen.findByText('AI đang tạm dừng vì tháng này đã dùng hết hạn mức.'),
    ).toBeVisible();
    expect(screen.getByText('Đã lưu khóa …abcd.')).toBeVisible();
    expect(screen.getByLabelText('Khóa API Anthropic (Claude)')).toHaveValue('');
    expect(document.body.textContent).not.toMatch(/sk-[a-z]/);
  });
});
