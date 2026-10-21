/// <reference lib="dom" />
// Search by meaning with mocked OpenAI embeddings (SPEC F33.3, F33.4): with AI on and embeddings
// off the palette says "Tìm theo từ khóa (BM25)"; "Bật tìm theo nghĩa" asks its own consent, the
// OpenAI key is saved, the index is built with visible progress until "Sẵn sàng."; the palette
// then says "Từ khóa và theo nghĩa" and "bài về ma trận" (no word in common with the note) shows
// "Đại số tuyến tính – chương 3" first under "Theo nghĩa". Notes in 3 Resources and 4 Archive are
// never in a request the mock received. The mock's vectors are deterministic: a small concept
// table stands for meaning (mock-ai-formats.ts). App and mock of its own.
import { expect, test, type Page } from '@playwright/test';
import {
  aiStatus,
  enableAiByApi,
  FAKE_OPENAI_KEY,
  startAiApp,
  type AiApp,
} from './helpers/ai-app.js';
import { appReady } from './helpers/keyboard.js';
import { UTF8_BROWSER } from './helpers/own-server.js';
import { shot, shotWide } from './helpers/screenshots.js';

test.use(UTF8_BROWSER);

let app: AiApp;
test.beforeEach(async () => {
  app = await startAiApp();
});
test.afterEach(async () => {
  expect(app.mock.failures).toEqual([]);
  await app.dispose();
});

const LINEAR = '2 Areas/Đại số tuyến tính – chương 3.md';
const NOTES: [string, string][] = [
  [
    LINEAR,
    '# Đại số tuyến tính – chương 3\n\nĐịnh thức của một bảng số vuông, hạng, và cách khử Gauss để giải hệ phương trình.\n',
  ],
  ['2 Areas/Giải tích 1 – đạo hàm.md', '# Giải tích 1 – đạo hàm\n\nĐạo hàm là tốc độ thay đổi.\n'],
  ['1 Projects/Kế hoạch tuần.md', '# Kế hoạch tuần\n\nĐi thư viện, gặp nhóm đồ án.\n'],
  ['Daily/2026-10-01.md', '# 2026-10-01\n\nHọc nhóm buổi tối.\n'],
  // Out of scope by default: never sent, even though they talk about matrices.
  [
    '3 Resources/Tài liệu ma trận.md',
    '# Tài liệu ma trận\n\nMa trận nghịch đảo zqxresourcesmarker.\n',
  ],
  ['4 Archive/Ma trận cũ.md', '# Ma trận cũ\n\nBài tập ma trận năm trước zqxarchivemarker.\n'],
];

async function palette(page: Page, query: string) {
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: 'Tìm ghi chú' });
  await expect(input).toBeFocused();
  await input.fill(query);
  return input;
}

test('Tìm theo nghĩa: own consent, progress to done, "bài về ma trận" finds chương 3; excluded folders never sent (F33.3, F33.4)', async ({
  page,
}) => {
  test.slow();
  const { mock, server } = app;
  const api = await server.api();
  for (const [notePath, content] of NOTES) {
    await api.send('POST', '/api/note', { path: notePath, content });
  }
  await enableAiByApi(api);
  mock.delayEmbeddings(1_500);

  // Embeddings off: the palette says keyword search; nothing was embedded.
  await page.goto(`${server.origin}/#/`);
  await appReady(page);
  await palette(page, 'bài về ma trận');
  await expect(page.locator('.palette-mode')).toHaveText('Tìm theo từ khóa (BM25)');
  await expect(page.getByRole('group', { name: 'Theo nghĩa' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(mock.requestsOf('embeddings')).toEqual([]);

  // Settings: its own consent dialog, then the OpenAI key; the backlog starts.
  await page.goto(`${server.origin}/#/settings`);
  const section = page.getByRole('region', { name: 'Tìm theo nghĩa (embeddings)' });
  await section.getByRole('switch', { name: 'Bật tìm theo nghĩa' }).click();
  const consent = page.getByRole('dialog', { name: 'Bật tìm theo nghĩa với OpenAI?' });
  await expect(consent).toBeVisible();
  await expect(consent).toContainText(
    'Từ khóa bạn gõ khi tìm kiếm, câu bạn hỏi AI, đoạn chữ bạn chọn khi bấm Gợi ý liên kết và ghi chú Inbox khi bấm Gợi ý chỗ để cũng được gửi tới OpenAI',
  );
  await expect(consent.getByRole('button', { name: 'Để sau' })).toBeFocused();
  await shot(page, 'ai-embeddings-consent-1280');
  await consent.getByRole('button', { name: 'Đồng ý và bật' }).click();
  await expect(section.getByText('Cần khóa API OpenAI để tạo chỉ mục theo nghĩa.')).toBeVisible();
  expect(mock.requestsOf('embeddings')).toEqual([]); // no key yet: nothing sent
  await section.getByLabel('Khóa API OpenAI').fill(FAKE_OPENAI_KEY);
  await section.getByRole('button', { name: 'Lưu khóa OpenAI' }).click();
  await expect(section.getByText(/^Đang (chờ để )?tạo chỉ mục theo nghĩa/)).toBeVisible();
  await shot(page, 'ai-embeddings-progress-1280');
  await expect(section.getByText('Sẵn sàng.')).toBeVisible({ timeout: 30_000 });
  const status = await aiStatus(api);
  expect(status.retrieval).toBe('hybrid');
  expect(status.embeddings).toMatchObject({ state: 'idle', lastError: null });
  expect(status.embeddings.done).toBe(status.embeddings.total);
  expect(status.embeddings.total).toBeGreaterThanOrEqual(4);

  // The palette: hybrid label, and the chapter on matrices first among "Theo nghĩa".
  await page.goto(`${server.origin}/#/`);
  await appReady(page);
  const asked = page.waitForResponse((r) => r.url().endsWith('/api/ai/search'));
  await palette(page, 'bài về ma trận');
  await asked;
  await expect(page.locator('.palette-mode')).toHaveText('Từ khóa và theo nghĩa');
  const meaning = page.getByRole('group', { name: 'Theo nghĩa' });
  await expect(meaning.getByRole('option').first()).toContainText('Đại số tuyến tính – chương 3');
  await expect(meaning).not.toContainText('Tài liệu ma trận');
  await expect(meaning).not.toContainText('Ma trận cũ');
  await shotWide(page, 'ai-palette-meaning');
  // Enter on it opens the note.
  for (let i = 0; i < 12; i += 1) {
    const active = await page.locator('.palette-option.is-active').textContent();
    if (active?.includes('Đại số tuyến tính – chương 3')) break;
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`path=${encodeURIComponent(LINEAR)}`));

  // Every request the mock saw: never a note of 3 Resources or 4 Archive.
  const embedded = mock.requestsOf('embeddings');
  expect(embedded.some((r) => r.user.includes('bài về ma trận'))).toBe(true);
  expect(embedded.some((r) => r.user.includes('Đại số tuyến tính – chương 3'))).toBe(true);
  for (const request of mock.requests) {
    const body = JSON.stringify(request.body);
    expect(body).not.toContain('zqxresourcesmarker');
    expect(body).not.toContain('zqxarchivemarker');
    expect(body).not.toContain('Tài liệu ma trận');
    expect(body).not.toContain('Ma trận cũ');
  }
});
