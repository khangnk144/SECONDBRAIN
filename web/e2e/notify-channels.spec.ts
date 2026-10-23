/// <reference lib="dom" />
// Telegram and email reminders (F31.1–F31.5, F35.2 badge) in a real browser, Bento style, against
// a local stand-in for the Telegram API (`SB_TELEGRAM_API_URL`) and a local SMTP server: the
// Settings blocks (switches wait for their fields, consent lines, secrets masked and never in the
// page), "Gửi thử" with a success and a refusal said in words, then a deadline reminder firing at
// the set minute sends exactly one message per channel, in Vietnamese, and a restart sends none
// again; the rail's "Nhắc nhở" shows the count.
import { expect, test, type Page } from '@playwright/test';
import {
  startFakeSmtpServer,
  type FakeSmtpServer,
} from '../../server/test/reminders/notify/fake-smtp-server.js';
import { isoAddDays, localIso } from './helpers/app-api.js';
import { startFakeTelegram, type FakeTelegram } from './helpers/fake-telegram.js';
import { createNote, mainNav } from './helpers/m5-app.js';
import { ownServer, type OwnServer } from './helpers/own-server.js';

const BOT_TOKEN = '123456789:AAE2eFakeBotTokenForTestsOnly_x9Zq';
const CHAT_ID = '987654321';
const PASSWORD = 'mat khau ung dung e2e';

let telegram: FakeTelegram;
let smtp: FakeSmtpServer;
let server: OwnServer;
test.beforeEach(async () => {
  telegram = await startFakeTelegram();
  smtp = await startFakeSmtpServer({ acceptLogin: true });
  server = ownServer(47697, { style: 'bento', env: { SB_TELEGRAM_API_URL: telegram.url } });
  await server.start();
});
test.afterEach(async () => {
  await server.dispose();
  await telegram.close();
  await smtp.close();
});

const group = (page: Page, name: string) => page.getByRole('group', { name, exact: true });

async function saveText(page: Page, scope: string, label: string, value: string) {
  const field = group(page, scope).getByLabel(label, { exact: true });
  await field.fill(value);
  await field.press('Enter');
}

test('Settings → Nhắc nhở: Telegram and email, consent, masked secrets, "Gửi thử" (F31.1, F31.3, F31.5)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${server.origin}/#/settings`);
  const tg = group(page, 'Telegram');
  await tg.scrollIntoViewIfNeeded();
  const tgSwitch = tg.getByRole('switch', { name: 'Gửi nhắc nhở qua Telegram' });
  await expect(tgSwitch).toBeDisabled();
  await expect(tg.getByText('Lưu mã bot và chat ID trước để bật.')).toBeVisible();
  // The consent line comes before the fields, so it points down at them (review B4).
  await expect(
    tg.getByText(/đến chat bạn nhập bên dưới, qua máy chủ của Telegram\.$/),
  ).toBeVisible();
  await expect(
    group(page, 'Email').getByText(/qua máy chủ SMTP bạn nhập bên dưới\.$/),
  ).toBeVisible();
  await expect(tg.getByRole('button', { name: 'Gửi thử qua Telegram' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  // A refused value is explained with its own reason.
  await saveText(page, 'Telegram', 'Chat ID', 'không phải số');
  await expect(
    tg.getByText('Chat ID là một dãy số (nhóm có dấu - ở đầu) hoặc @tên_kênh.'),
  ).toBeVisible();

  await saveText(page, 'Telegram', 'Mã bot (bot token)', BOT_TOKEN);
  await expect(tg.getByText(`Đã lưu, kết thúc bằng …${BOT_TOKEN.slice(-4)}.`)).toBeVisible();
  await saveText(page, 'Telegram', 'Chat ID', CHAT_ID);
  await expect(
    tg.getByText(
      `Khi bật, app gửi tên deadline, ngày hạn và đường dẫn ghi chú đến chat ${CHAT_ID} qua máy chủ của Telegram.`,
    ),
  ).toBeVisible();
  await expect(tgSwitch).toBeEnabled();
  expect(telegram.messages, 'no network call while nothing was asked').toEqual([]);

  // "Gửi thử" before the channel is on: one test message; then a refusal in words.
  await tg.getByRole('button', { name: 'Gửi thử qua Telegram' }).click();
  await expect(tg.getByText('Đã gửi tin nhắn thử. Xem Telegram của bạn nhé.')).toBeVisible();
  expect(telegram.messages).toHaveLength(1);
  expect(telegram.messages[0]).toMatchObject({ token: BOT_TOKEN, chatId: CHAT_ID });
  expect(telegram.messages[0]!.text).toContain('Đây là tin nhắn thử từ Second Brain.');
  telegram.answer = 'unauthorized';
  await tg.getByRole('button', { name: 'Gửi thử qua Telegram' }).click();
  await expect(
    tg.getByText('Chưa gửi được: Telegram không nhận mã bot. Kiểm tra lại mã từ @BotFather.'),
  ).toBeVisible();
  telegram.answer = 'ok';
  await tgSwitch.click();
  await expect(tgSwitch).toBeChecked();

  // Email through the local SMTP server, no encryption, with a login.
  const mail = group(page, 'Email');
  const mailSwitch = mail.getByRole('switch', { name: 'Gửi nhắc nhở qua email' });
  await expect(mailSwitch).toBeDisabled();
  await saveText(page, 'Email', 'Máy chủ SMTP', '127.0.0.1');
  await saveText(page, 'Email', 'Cổng SMTP', String(smtp.port));
  await mail.getByRole('radio', { name: 'Không mã hóa' }).click();
  await expect(mail.getByRole('radio', { name: 'Không mã hóa' })).toBeChecked();
  await saveText(page, 'Email', 'Tên đăng nhập', 'khangnie');
  await saveText(page, 'Email', 'Mật khẩu', PASSWORD);
  await expect(mail.getByText(`Đã lưu, kết thúc bằng …${PASSWORD.slice(-4)}.`)).toBeVisible();
  await saveText(page, 'Email', 'Địa chỉ gửi', 'app@may.local');
  await saveText(page, 'Email', 'Gửi đến', 'khangnie@truong.edu.vn');
  await expect(
    mail.getByText(
      'Khi bật, app gửi tên deadline, ngày hạn và đường dẫn ghi chú đến khangnie@truong.edu.vn qua máy chủ 127.0.0.1.',
    ),
  ).toBeVisible();
  await mail.getByRole('button', { name: 'Gửi thử qua Email' }).click();
  await expect(mail.getByText(/^Đã gửi tin nhắn thử\./)).toBeVisible({ timeout: 20_000 });
  expect(smtp.messages).toHaveLength(1);
  expect(smtp.messages[0]).toMatch(/^To: khangnie@truong\.edu\.vn$/m);
  await mailSwitch.click();
  await expect(mailSwitch).toBeChecked();

  // Secrets never reach the page, its storage or the settings answer in full.
  await page.reload();
  await expect(
    group(page, 'Telegram').getByText(`Đã lưu, kết thúc bằng …${BOT_TOKEN.slice(-4)}.`),
  ).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain(BOT_TOKEN);
  expect(html).not.toContain(PASSWORD);
  const answer = JSON.stringify(await (await server.api()).get('/api/settings'));
  expect(answer).not.toContain(BOT_TOKEN);
  expect(answer).not.toContain(PASSWORD);
  expect(server.output()).not.toContain(BOT_TOKEN.split(':')[1]);
});

test('a reminder that fires sends one message per channel, never again after a restart (F31.2, F31.4)', async ({
  page,
}) => {
  // Waits for the scheduler's 60 s tick, twice.
  test.setTimeout(300_000);
  const now = new Date();
  test.skip(
    now.getHours() === 23 && now.getMinutes() >= 55,
    'the reminder minute would cross midnight',
  );
  const api = await server.api();
  const title = 'Đồ án nhắc qua kênh';
  const deadline = isoAddDays(localIso(), 3);
  await createNote(
    api,
    `1 Projects/${title}.md`,
    `---\ntype: project\nstatus: doing\ndeadline: ${deadline}\n---\n\n# ${title}\n`,
  );
  await api.send('PUT', '/api/settings', {
    notify: {
      telegram: { enabled: true, botToken: BOT_TOKEN, chatId: CHAT_ID },
      email: {
        enabled: true,
        host: '127.0.0.1',
        port: smtp.port,
        security: 'none',
        from: 'app@may.local',
        to: 'khangnie@truong.edu.vn',
      },
    },
  });
  const pad = (n: number) => String(n).padStart(2, '0');
  const minute = new Date();
  await api.send('PUT', '/api/settings', {
    reminders: { time: `${pad(minute.getHours())}:${pad(minute.getMinutes())}` },
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${server.origin}/`);

  await expect
    .poll(() => telegram.messages.length, { timeout: 150_000, intervals: [2_000] })
    .toBe(1);
  await expect.poll(() => smtp.messages.length, { timeout: 30_000 }).toBe(1);
  const [y, m, d] = deadline.split('-');
  const notePath = `1 Projects/${title}.md`;
  expect(telegram.messages[0]!.text).toContain(`⏰ ${title} – hạn ${d}/${m}/${y} (còn 3 ngày)`);
  expect(telegram.messages[0]!.text).toContain(`Ghi chú: ${notePath}`);
  expect(telegram.messages[0]!.text).toMatch(
    /Mở trong Second Brain: http:\/\/localhost:47697\/#\/note\?path=/,
  );
  // The toast and the in-app list are unaffected: the rail counts the reminder.
  await expect(
    mainNav(page)
      .getByRole('link', { name: /^Nhắc nhở/ })
      .locator('.rail-item__badge'),
  ).toContainText('1');
  await mainNav(page)
    .getByRole('link', { name: /^Nhắc nhở/ })
    .click();
  await expect(page.locator('.reminder-row').filter({ hasText: title })).toBeVisible();

  // A restart (catch-up runs at start) and another tick: nothing is sent twice.
  await server.stop();
  await server.start();
  await page.goto(`${server.origin}/`);
  await page.waitForTimeout(70_000);
  expect(telegram.messages).toHaveLength(1);
  expect(smtp.messages).toHaveLength(1);
});
