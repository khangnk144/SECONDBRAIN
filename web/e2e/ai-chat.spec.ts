/// <reference lib="dom" />
// Scenario S5 with a mocked provider (SPEC §2, F33.1–F33.3): AI off → the Ask screen says "AI
// chưa bật" and the mock receives nothing; Settings → consent dialog → fake key → ready; "Tuần
// này có gì đến hạn?" → the mock answers the intent step and a short intro → the answer lists
// exactly Today's open items of this week (overdue first), each a working link, and the intro
// call never saw them; "Lưu thành ghi chú" creates the note; a text question whose answer cites
// [S1] and a bogus [S7] shows one link and the rejected-citation notice; "Dừng" mid-stream closes
// the provider stream; AI off again → nothing more is sent. App and mock of its own.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  aiStatus,
  enableAiByApi,
  FAKE_ANTHROPIC_KEY,
  startAiApp,
  type AiApp,
} from './helpers/ai-app.js';
import { localIso, type AppApi } from './helpers/app-api.js';
import { UTF8_BROWSER } from './helpers/own-server.js';
import { shot, shotWide } from './helpers/screenshots.js';

test.use(UTF8_BROWSER);

let app: AiApp | null = null;
test.afterEach(async () => {
  expect(app?.mock.failures ?? []).toEqual([]);
  await app?.dispose();
  app = null;
});

interface Item {
  id: string;
  kind: 'note' | 'task';
  title: string;
  noteTitle: string;
  path: string;
  date: string;
}
interface Today {
  date: string;
  week: { start: string; end: string };
  strip: { days: { date: string; items: Item[] }[]; overdue: Item[] };
}

const STATS_NOTE = '2 Areas/Ôn tập thống kê.md';
/**
 * How an answer row names an item: a task's own `[[a|b]]`/`[[a]]` links as their words (the row's
 * one link is the item's note; the sample's homework names its course as a link).
 */
const shownTitle = (item: Item) =>
  item.kind === 'task'
    ? item.title.replace(/!?\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    : item.noteTitle;
const question = (page: Page) => page.getByRole('textbox', { name: 'Câu hỏi của bạn' });
const lastAnswer = (page: Page) => page.locator('li.ai-chat__turn--ai').last();

/** Asks on the Ask screen and waits until the answer is finished (or stopped). */
async function ask(page: Page, text: string) {
  await question(page).fill(text);
  await question(page).press('Enter');
  await expect(page.locator('li.ai-chat__turn--ai')).not.toHaveCount(0);
}
async function answered(page: Page) {
  await expect(lastAnswer(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 15_000 });
  await expect(lastAnswer(page).locator('.ai-answer')).toBeVisible();
}

/** Today's open items of this week as the Today strip has them: overdue, then today…Sunday. */
async function thisWeek(api: AppApi): Promise<{ today: Today; items: Item[] }> {
  const today = await api.get<Today>('/api/today');
  const days = today.strip.days.filter((d) => d.date <= today.week.end);
  return { today, items: [...today.strip.overdue, ...days.flatMap((d) => d.items)] };
}

test('S5: consent and key, deadlines of this week exactly as Today, citations checked, Dừng (F33.1–F33.3)', async ({
  page,
}) => {
  test.slow();
  app = await startAiApp();
  const { mock, server } = app;
  const api = await server.api();
  await api.send('POST', '/api/sample-data');
  await api.send('POST', '/api/note', {
    path: STATS_NOTE,
    content:
      '# Ôn tập thống kê\n\nĐường cong Gauss có đồ thị hình chuông, đối xứng quanh giá trị trung bình.\n',
  });

  // AI off: the Ask screen explains, offers Settings, and has no input; nothing reaches the mock.
  await page.goto(`${server.origin}/#/ask`);
  await expect(page.getByRole('heading', { level: 1, name: 'Hỏi ghi chú của bạn' })).toBeVisible();
  await expect(page.getByText('AI chưa bật. Bạn bật được trong Cài đặt, mục AI.')).toBeVisible();
  await expect(question(page)).toHaveCount(0);
  await shot(page, 'ai-ask-off-1280');
  const refused = await page.request.post(`${server.origin}/api/ai/chat`, {
    headers: { 'X-SB-Token': api.token, Origin: server.origin },
    data: { question: 'Tuần này có gì đến hạn?' },
  });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error.code).toBe('AI_DISABLED');
  await page.goto(`${server.origin}/#/`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(mock.requests).toEqual([]);

  // Settings: the switch opens the consent dialog; agree, then paste the key → ready.
  await page.goto(`${server.origin}/#/settings`);
  await page.getByRole('switch', { name: 'Bật AI trong app' }).click();
  const consent = page.getByRole('dialog', { name: 'Bật AI với Anthropic (Claude)?' });
  await expect(consent).toBeVisible();
  await expect(consent.getByRole('button', { name: 'Để sau' })).toBeFocused();
  await expect(consent).toContainText('Được gửi đi');
  await expect(consent).toContainText('Không bao giờ gửi');
  await shotWide(page, 'ai-consent-dialog');
  await consent.getByRole('button', { name: 'Đồng ý và bật' }).click();
  await expect(consent).toHaveCount(0);
  await expect(page.getByText(/AI đã bật nhưng chưa có khóa API Anthropic/)).toBeVisible();
  await page.getByLabel('Khóa API Anthropic (Claude)').fill(FAKE_ANTHROPIC_KEY);
  await page.getByRole('button', { name: 'Lưu khóa Anthropic (Claude)' }).click();
  await expect(
    page.getByText('AI đang bật với Anthropic (Claude), mô hình claude-haiku-5-5.'),
  ).toBeVisible();
  expect(mock.requests).toEqual([]); // turning AI on sends nothing by itself

  // "Tuần này có gì đến hạn?": intent JSON, then a short intro; the list comes from the server.
  const { today, items } = await thisWeek(api);
  expect(items.length).toBeGreaterThan(1);
  mock.reply(
    'intent',
    JSON.stringify({
      kind: 'deadlines',
      from: today.week.start,
      to: today.week.end,
      overdue: true,
      about: [],
    }),
  );
  mock.reply('intro', `Tuần này bạn có ${items.length} việc còn mở, xem danh sách bên dưới nhé.`);
  await page.getByRole('navigation').getByRole('link', { name: 'Hỏi AI' }).click();
  await expect(page).toHaveURL(/#\/ask/);
  await expect(page.getByText(/được gửi đến Anthropic \(Claude\) để trả lời/)).toBeVisible();
  await shotWide(page, 'ai-ask-ready');
  await ask(page, 'Tuần này có gì đến hạn?');
  await answered(page);
  const answer = lastAnswer(page).locator('.ai-answer');
  await expect(answer).toContainText('Tuần này bạn có');
  const rows = answer.locator('li');
  await expect(rows).toHaveCount(items.length);
  const rendered = await rows.evaluateAll((list) =>
    list.map((li) => ({
      text: li.textContent ?? '',
      hrefs: [...li.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? ''),
    })),
  );
  items.forEach((item, i) => {
    const row = rendered[i]!;
    expect(row.text, `row ${i}`).toContain(shownTitle(item));
    expect(row.hrefs, `row ${i}`).toEqual([`#/note?path=${encodeURIComponent(item.path)}`]);
  });
  await expect(lastAnswer(page)).toContainText('Lấy từ trang Hôm nay');
  expect(mock.requestsOf('intent')).toHaveLength(1);
  expect(mock.requestsOf('intent')[0]!.user).toContain('Tuần này có gì đến hạn?');
  const intro = mock.requestsOf('intro');
  expect(intro).toHaveLength(1);
  for (const item of items) expect(intro[0]!.user).not.toContain(item.title);
  await shotWide(page, 'ai-chat-deadlines');

  // Each row is a working link: the first opens its note; back to the same conversation.
  await rows.first().locator('a').click();
  await expect(page).toHaveURL(new RegExp(`path=${encodeURIComponent(items[0]!.path)}`));
  await page.goBack();
  await expect(lastAnswer(page).locator('.ai-answer li')).toHaveCount(items.length);

  // "Lưu thành ghi chú": the dialog saves the Q&A as a new note (Inbox by default).
  await lastAnswer(page).getByRole('button', { name: 'Lưu thành ghi chú' }).click();
  const dialog = page.getByRole('dialog', { name: 'Lưu câu trả lời thành ghi chú' });
  await expect(dialog.getByRole('radio').first()).toBeChecked();
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/ai/save-answer'));
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click();
  const savedPath = ((await (await saved).json()) as { path: string }).path;
  await expect(page.getByText('Đã lưu thành ghi chú')).toBeVisible();
  expect(savedPath.startsWith('0 Inbox/')).toBe(true);
  const savedFile = path.join(server.vaultDir, ...savedPath.split('/'));
  expect(existsSync(savedFile)).toBe(true);
  const savedText = readFileSync(savedFile, 'utf8');
  expect(savedText).toContain('Tuần này có gì đến hạn?');
  expect(savedText).toContain(shownTitle(items[0]!));

  // A text question: the model cites [S1] (the statistics note) and a bogus [S7].
  mock.reply('intent', '{"kind":"text","from":null,"to":null,"overdue":false,"about":[]}');
  mock.reply('answer', (request) => {
    const sources = request.user.match(/<source /g)?.length ?? 0;
    if (sources >= 7) throw new Error(`S7 would be a real source (${sources} sources)`);
    return 'Đường cong Gauss có đồ thị hình chuông [S1]. Gauss đã mô tả nó từ năm 1809 [S7].';
  });
  await page.getByRole('button', { name: 'Cuộc trò chuyện mới' }).click();
  // Rare words, so retrieval finds fewer than 7 sources and [S7] is outside the set.
  await ask(page, 'Chuông Gauss đối xứng ra sao?');
  await answered(page);
  const text = lastAnswer(page).locator('.ai-answer');
  await expect(text).toContainText('đồ thị hình chuông');
  await expect(text).not.toContainText('[S7]');
  await expect(text.locator('a')).toHaveCount(1);
  await expect(text.locator('a')).toHaveAttribute(
    'href',
    `#/note?path=${encodeURIComponent(STATS_NOTE)}`,
  );
  await expect(
    lastAnswer(page).getByText('Một vài trích dẫn không khớp ghi chú nào nên đã được bỏ.'),
  ).toBeVisible();
  await expect(lastAnswer(page).getByRole('button', { name: /^Nguồn \(\d+\)$/ })).toBeVisible();
  expect(mock.requestsOf('answer')[0]!.user).toContain('Đường cong Gauss có đồ thị hình chuông');
  await shot(page, 'ai-chat-citation-rejected-1280');

  // "Dừng" mid-stream: the answer stops and the provider stream is closed.
  mock.reply('answer', {
    chunks: ['Đường cong Gauss ', 'dùng để mô tả ', 'nhiều đại lượng tự nhiên [S1].'],
    holdAfter: 1,
  });
  await ask(page, 'Chuông Gauss dùng để làm gì?');
  await expect(lastAnswer(page).locator('.ai-chat__streamed')).toContainText('Đường cong Gauss');
  await page.getByRole('button', { name: 'Dừng' }).click();
  await expect(lastAnswer(page).getByText('Đã dừng.')).toBeVisible();
  await expect.poll(() => mock.closedEarly).toBe(1);
  await expect(page.getByRole('button', { name: 'Hỏi', exact: true })).toBeVisible();

  // AI off again: the screen says so and nothing more is sent, from the UI or the API.
  await page.goto(`${server.origin}/#/settings`);
  await page.getByRole('switch', { name: 'Bật AI trong app' }).click();
  await expect(page.getByText('AI đang tắt. App không gửi gì đi.')).toBeVisible();
  const sent = mock.requests.length;
  await page.goto(`${server.origin}/#/ask`);
  await expect(page.getByText('AI chưa bật. Bạn bật được trong Cài đặt, mục AI.')).toBeVisible();
  await expect(question(page)).toHaveCount(0);
  const again = await page.request.post(`${server.origin}/api/ai/chat`, {
    headers: { 'X-SB-Token': api.token, Origin: server.origin },
    data: { question: 'Chuông Gauss đối xứng ra sao?' },
  });
  expect(again.status()).toBe(409);
  await page.goto(`${server.origin}/#/`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(500);
  expect(mock.requests.length).toBe(sent);
});

test('the monthly limit reached pauses AI with a notice and sends nothing; a higher limit resumes (F33.5)', async ({
  page,
}) => {
  // This month already used 10,000 tokens (the machine-wide usage file), and the limit is 10,000.
  app = await startAiApp({
    seedHome: (home) => {
      mkdirSync(path.join(home, '.secondbrain'), { recursive: true });
      writeFileSync(
        path.join(home, '.secondbrain', 'ai-usage.json'),
        JSON.stringify({
          version: 1,
          months: { [localIso().slice(0, 7)]: { tokens: 10_000, requests: 4 } },
        }),
      );
    },
  });
  const { mock, server } = app;
  const api = await server.api();
  await api.send('POST', '/api/note', {
    path: STATS_NOTE,
    content: '# Ôn tập thống kê\n\nĐường cong Gauss có đồ thị hình chuông.\n',
  });
  await enableAiByApi(api);
  await api.send('PUT', '/api/settings', { ai: { monthlyTokenLimit: 10_000 } });
  expect(await aiStatus(api)).toMatchObject({ ready: false, reason: 'budget' });

  await page.goto(`${server.origin}/#/ask`);
  await expect(
    page.getByText(
      'Đã dùng hết hạn mức tháng này (10.000 token). Tăng hạn mức trong Cài đặt hoặc chờ sang tháng.',
    ),
  ).toBeVisible();
  await expect(question(page)).toHaveCount(0);
  const refused = await page.request.post(`${server.origin}/api/ai/chat`, {
    headers: { 'X-SB-Token': api.token, Origin: server.origin },
    data: { question: 'Chuông Gauss đối xứng ra sao?' },
  });
  expect(refused.status()).toBe(429);
  expect((await refused.json()).error.code).toBe('AI_BUDGET');
  await page.goto(`${server.origin}/#/settings`);
  await expect(page.getByText('AI đang tạm dừng vì tháng này đã dùng hết hạn mức.')).toBeVisible();
  await expect(
    page.getByText(/AI đang tạm dừng vì tháng này đã dùng hết 10\.000 token/),
  ).toBeVisible();
  expect(mock.requests).toEqual([]);

  // A higher limit, typed the way she writes numbers: AI answers again.
  const limit = page.getByLabel('Hạn mức mỗi tháng (token)');
  await limit.fill('2.000.000');
  await limit.press('Enter');
  await expect(
    page.getByText('AI đang bật với Anthropic (Claude), mô hình claude-haiku-5-5.'),
  ).toBeVisible();
  mock.reply('answer', 'Đường cong Gauss có đồ thị hình chuông [S1].');
  await page.goto(`${server.origin}/#/ask`);
  await ask(page, 'Chuông Gauss đối xứng ra sao?');
  await answered(page);
  await expect(lastAnswer(page).locator('.ai-answer a')).toHaveCount(1);
  expect(mock.requestsOf('answer')).toHaveLength(1);
});
