import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { installSettingsRoutes, renderSettings, settingsResponse } from './settings-test-kit';

let mock: FetchMock;
const BOT = '7012345678:AAH-TELEGRAMSECRET1111111111111111bbbb';

async function block(name: string) {
  return within(await screen.findByRole('group', { name }));
}

describe('Settings: reminders by Telegram and email (F31.1, F31.3)', () => {
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('(F31.1) Telegram: off, can only be turned on once bot token and chat id are saved', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    const telegram = await block('Telegram');
    const toggle = telegram.getByRole('switch', { name: 'Gửi nhắc nhở qua Telegram' });
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeDisabled();
    expect(telegram.getByText('Lưu mã bot và chat ID trước để bật.')).toBeVisible();
    // The how-to names @BotFather and the way to the chat id.
    await user.click(telegram.getByText('Cách lấy mã bot và chat ID'));
    expect(telegram.getByText(/mở @BotFather, gửi \/newbot/)).toBeVisible();
    expect(telegram.getByText(/Mở @userinfobot/)).toBeVisible();

    const token = telegram.getByLabelText('Mã bot (bot token)');
    expect(token).toHaveAttribute('type', 'password');
    await user.type(token, `${BOT}{Enter}`);
    expect(await telegram.findByText('Đã lưu, kết thúc bằng …bbbb.')).toBeVisible();
    await user.type(telegram.getByRole('textbox', { name: 'Chat ID' }), '123456789{Enter}');
    await waitFor(() => expect(toggle).toBeEnabled());
    // The consent line names what is sent and to whom.
    expect(
      telegram.getByText(
        'Khi bật, app gửi tên deadline, ngày hạn và đường dẫn ghi chú đến chat 123456789 qua máy chủ của Telegram.',
      ),
    ).toBeVisible();
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(mock.callsTo('PUT /api/settings').map((c) => c.body)).toEqual([
      { notify: { telegram: { botToken: BOT } } },
      { notify: { telegram: { chatId: '123456789' } } },
      { notify: { telegram: { enabled: true } } },
    ]);
    expect(document.body.textContent).not.toContain('TELEGRAMSECRET');
  });

  it('(F31.1) "Gửi thử" sends a test and says what happened, in words', async () => {
    const user = userEvent.setup();
    const settings = settingsResponse();
    settings.notify.telegram = {
      enabled: false,
      chatId: '@kenh_rieng',
      botToken: { set: true, last4: '…bbbb' },
    };
    installSettingsRoutes(mock, settings);
    let answer: unknown = { ok: true };
    mock.on('POST /api/notify/test', () => ({ body: answer }));
    renderSettings();
    const telegram = await block('Telegram');
    const send = telegram.getByRole('button', { name: 'Gửi thử qua Telegram' });
    await user.click(send);
    expect(
      await telegram.findByText('Đã gửi tin nhắn thử. Xem Telegram của bạn nhé.'),
    ).toBeVisible();
    expect(mock.callsTo('POST /api/notify/test').map((c) => c.body)).toEqual([
      { channel: 'telegram' },
    ]);
    answer = { ok: false, error: 'chat-not-found' };
    await user.click(send);
    expect(await telegram.findByRole('alert')).toHaveTextContent(
      'Chưa gửi được: Telegram không tìm thấy chat này, hoặc bạn chưa bấm Start với bot. Kiểm tra chat ID rồi bấm Start.',
    );
  });

  it('(B4) the consent line points down at the fields that follow it', async () => {
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    const telegram = await block('Telegram');
    const chat = telegram.getByText(/đến chat bạn nhập bên dưới, qua máy chủ của Telegram\.$/);
    const follows = (first: Element, second: Element) =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(chat, telegram.getByLabelText('Mã bot (bot token)'))).toBe(true);
    const email = await block('Email');
    const smtp = email.getByText(/qua máy chủ SMTP bạn nhập bên dưới\.$/);
    expect(follows(smtp, email.getByRole('textbox', { name: 'Máy chủ SMTP' }))).toBe(true);
    expect(document.body.textContent).not.toMatch(/nhập ở trên/);
  });

  it('(F31.1) email: every field, security choice, masked password, consent naming the address and server', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    const email = await block('Email');
    const toggle = email.getByRole('switch', { name: 'Gửi nhắc nhở qua email' });
    expect(toggle).toBeDisabled();
    await user.type(email.getByRole('textbox', { name: 'Máy chủ SMTP' }), 'smtp.gmail.com{Enter}');
    await user.click(email.getByRole('radio', { name: 'TLS' }));
    const port = email.getByRole('textbox', { name: 'Cổng SMTP' });
    await user.clear(port);
    await user.type(port, '465{Enter}');
    await user.type(
      email.getByRole('textbox', { name: 'Địa chỉ gửi' }),
      'khangnie@gmail.com{Enter}',
    );
    await user.type(
      email.getByRole('textbox', { name: 'Gửi đến' }),
      'khangnie@truong.edu.vn{Enter}',
    );
    await waitFor(() => expect(toggle).toBeEnabled());
    // A user name needs its password before the switch can turn on.
    await user.type(
      email.getByRole('textbox', { name: 'Tên đăng nhập' }),
      'khangnie@gmail.com{Enter}',
    );
    await waitFor(() => expect(toggle).toBeDisabled());
    const password = email.getByLabelText('Mật khẩu');
    expect(password).toHaveAttribute('type', 'password');
    await user.type(password, 'abcd efgh ijkl mnop{Enter}');
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(email.getByText('Đã lưu, kết thúc bằng …mnop.')).toBeVisible();
    expect(
      email.getByText(
        'Khi bật, app gửi tên deadline, ngày hạn và đường dẫn ghi chú đến khangnie@truong.edu.vn qua máy chủ smtp.gmail.com.',
      ),
    ).toBeVisible();
    expect(mock.callsTo('PUT /api/settings').map((c) => c.body)).toEqual([
      { notify: { email: { host: 'smtp.gmail.com' } } },
      { notify: { email: { security: 'tls' } } },
      { notify: { email: { port: 465 } } },
      { notify: { email: { from: 'khangnie@gmail.com' } } },
      { notify: { email: { to: 'khangnie@truong.edu.vn' } } },
      { notify: { email: { user: 'khangnie@gmail.com' } } },
      { notify: { email: { password: 'abcd efgh ijkl mnop' } } },
    ]);
    expect(password).toHaveValue('');
  });

  it('a refused value is explained with its own reason', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    mock.on(
      'PUT /api/settings',
      apiError(400, 'VALIDATION', { field: 'notify.email.to', reason: 'email-format' }),
    );
    renderSettings();
    const email = await block('Email');
    await user.type(email.getByRole('textbox', { name: 'Gửi đến' }), 'không phải email{Enter}');
    expect(await email.findByRole('alert')).toHaveTextContent(
      'Nhập một địa chỉ email, ví dụ ban@truong.edu.vn.',
    );
  });

  it('(F31.3) "Không mã hóa" for a server elsewhere is refused with a sentence that says why', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    mock.on(
      'PUT /api/settings',
      apiError(400, 'VALIDATION', { field: 'notify.email.security', reason: 'tls-required' }),
    );
    renderSettings();
    const email = await block('Email');
    expect(
      email.getByText('Không mã hóa chỉ dùng được với máy chủ trên chính máy này.'),
    ).toBeVisible();
    await user.click(email.getByRole('radio', { name: 'Không mã hóa' }));
    expect(await email.findByRole('alert')).toHaveTextContent(
      'Chỉ chọn Không mã hóa khi máy chủ SMTP chạy trên chính máy này (localhost, 127.0.0.1).',
    );
  });

  it('shows the last failure of real reminders from the outbox', async () => {
    installSettingsRoutes(mock, settingsResponse());
    mock.on('GET /api/notify/status', {
      body: {
        available: true,
        telegram: { pending: 1, lastSentAt: null, lastError: 'auth' },
        email: { pending: 0, lastSentAt: null, lastError: null },
      },
    });
    renderSettings();
    const telegram = await block('Telegram');
    expect(
      await telegram.findByText(
        'Lần gửi gần nhất bị lỗi: Telegram không nhận mã bot. Kiểm tra lại mã từ @BotFather. App sẽ thử lại.',
      ),
    ).toBeVisible();
    expect(telegram.getByText('Đang chờ gửi: 1 tin.')).toBeVisible();
  });

  it('has English texts', async () => {
    installSettingsRoutes(
      mock,
      settingsResponse({ ui: { ...settingsResponse().ui, language: 'en' } }),
    );
    await i18n.changeLanguage('en');
    try {
      renderSettings();
      const email = await block('Email');
      expect(email.getByRole('switch', { name: 'Send reminders by email' })).toBeDisabled();
      expect(email.getByRole('radio', { name: 'No encryption' })).toBeVisible();
      const telegram = await block('Telegram');
      expect(telegram.getByRole('button', { name: 'Send a test via Telegram' })).toBeVisible();
    } finally {
      await i18n.changeLanguage('vi');
    }
  });
});
