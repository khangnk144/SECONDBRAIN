/// <reference lib="dom" />
// AI on a selection and Inbox tidying with a mocked provider (SPEC F33 editor actions, owner
// request R1 "AI proposes, you accept"): select a paragraph → AI → "Tóm tắt" → "Chèn bên dưới"
// → the saved file gains exactly one block and every other byte stays; "Gợi ý thẻ" → accept one
// of two → only that tag is added to `tags:`; an Inbox note → "Gợi ý chỗ để" → "Áp dụng" → moved
// and renamed in one step with the 10 s undo toast; "Hoàn tác" puts it back. Nothing is sent
// before a click. App and mock of its own.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { enableAiByApi, startAiApp, type AiApp } from './helpers/ai-app.js';
import type { AppApi } from './helpers/app-api.js';
import { splitChunks } from './helpers/mock-ai-formats.js';
import { noteBody, noteHash, noteTitle } from './helpers/note-page.js';
import { UTF8_BROWSER } from './helpers/own-server.js';
import { shot, shotWide } from './helpers/screenshots.js';

test.use(UTF8_BROWSER);

let app: AiApp;
test.beforeEach(async () => {
  app = await startAiApp();
  await enableAiByApi(await app.server.api());
});
test.afterEach(async () => {
  expect(app.mock.failures).toEqual([]);
  await app.dispose();
});

const LIMITS = '2 Areas/Giới hạn của hàm số.md';
const LIMITS_TEXT = [
  '---',
  'type: lecture',
  'tags: [giải-tích]',
  '---',
  '',
  '# Giới hạn của hàm số',
  '',
  'Giới hạn cho biết giá trị của hàm khi biến tiến gần một điểm, dù hàm có thể không xác định tại điểm đó.',
  '',
  'Ví dụ: sin(x)/x tiến về 1 khi x tiến về 0.',
  '',
].join('\n');
const SUMMARY = 'Giới hạn là giá trị hàm tiến tới khi biến tiến gần một điểm.';

const readNote = (api: AppApi, notePath: string) =>
  api.get<{ content: string; revision: string }>(`/api/note?path=${encodeURIComponent(notePath)}`);

/** Selects the whole paragraph that contains `text` (triple click, as people do). */
async function selectParagraph(page: Page, text: string) {
  await noteBody(page).locator('p', { hasText: text }).click({ clickCount: 3 });
  await expect
    .poll(() => page.evaluate(() => document.getSelection()?.toString() ?? ''))
    .toContain(text);
}

async function chooseAiAction(page: Page, label: string) {
  await page.getByRole('button', { name: 'AI cho đoạn đã chọn' }).click();
  await page.getByRole('menuitem', { name: label }).click();
}

test('selection → Tóm tắt → Chèn bên dưới adds exactly one block; Gợi ý thẻ adds the accepted tag only', async ({
  page,
}) => {
  const { mock, server } = app;
  const api = await server.api();
  await api.send('POST', '/api/note', { path: LIMITS, content: LIMITS_TEXT });
  await api.send('POST', '/api/note', {
    path: '2 Areas/Đạo hàm.md',
    content: '---\ntags: [toán, giải-tích]\n---\n\n# Đạo hàm\n',
  });
  await page.goto(`${server.origin}/${noteHash(LIMITS)}`);
  await expect(noteTitle(page)).toHaveValue('Giới hạn của hàm số');
  await expect(page.getByRole('button', { name: 'AI cho đoạn đã chọn' })).toBeVisible();
  const before = mock.requests.filter((r) => r.kind !== 'today').length;

  // A slow answer, so the panel's waiting state (what is sent where) can be read.
  mock.reply('summarize', { chunks: splitChunks(SUMMARY), delayMs: 400 });
  await selectParagraph(page, 'Giới hạn cho biết');
  expect(mock.requests.filter((r) => r.kind !== 'today')).toHaveLength(before); // nothing yet
  await chooseAiAction(page, 'Tóm tắt');
  const panel = page.getByRole('dialog', { name: /Tóm tắt/ });
  await expect(panel.getByRole('status')).toHaveText('Đang hỏi AI…');
  await expect(panel).toContainText('Đoạn đã chọn được gửi tới Anthropic (Claude).');
  await expect(panel.getByRole('button', { name: 'Hủy' })).toBeFocused();
  await expect(panel).toContainText(SUMMARY);
  await expect(panel.getByRole('button', { name: 'Chèn bên dưới' })).toBeFocused();
  await shotWide(page, 'ai-editor-summary-panel');
  const sent = mock.requestsOf('summarize');
  expect(sent).toHaveLength(1);
  expect(sent[0]!.user).toContain('Giới hạn cho biết giá trị của hàm');
  expect(sent[0]!.user).not.toContain('sin(x)/x');
  await panel.getByRole('button', { name: 'Chèn bên dưới' }).click();
  await expect(panel).toHaveCount(0);
  await expect(noteBody(page).locator('blockquote')).toContainText(`Tóm tắt (AI): ${SUMMARY}`);

  // On disk: the original bytes plus exactly one block after the selected paragraph.
  const block = `> **Tóm tắt (AI):** ${SUMMARY}`;
  await expect.poll(async () => (await readNote(api, LIMITS)).content).toContain(block);
  const saved = (await readNote(api, LIMITS)).content;
  expect(saved.split(block)).toHaveLength(2);
  expect(saved.replace(`${block}\n\n`, '')).toBe(LIMITS_TEXT);
  expect(saved.indexOf(block)).toBeGreaterThan(saved.indexOf('dù hàm có thể không xác định'));
  expect(saved.indexOf(block)).toBeLessThan(saved.indexOf('Ví dụ:'));

  // "Gợi ý thẻ": two proposals (one she already uses elsewhere, one new); she keeps one.
  mock.reply('tags', '{"tags":["toán","giới-hạn","giải-tích"]}');
  await selectParagraph(page, 'Ví dụ: sin(x)/x');
  await chooseAiAction(page, 'Gợi ý thẻ');
  const tags = page.getByRole('dialog', { name: /Gợi ý thẻ/ });
  const choices = tags.getByRole('list', { name: 'Thẻ gợi ý' }).getByRole('checkbox');
  await expect(choices).toHaveCount(2); // giải-tích is already on the note
  await expect(tags.getByText('#toán')).toBeVisible();
  await expect(tags.getByText('#giới-hạn')).toBeVisible();
  expect(mock.requestsOf('tags')[0]!.user).toContain('#toán');
  await tags.getByRole('checkbox', { name: /giới-hạn/ }).uncheck();
  await tags.getByRole('button', { name: 'Thêm thẻ' }).click();
  await expect(page.getByText('Đã thêm 1 thẻ.')).toBeVisible();
  await expect
    .poll(async () => (await readNote(api, LIMITS)).content)
    .toMatch(/^---\ntype: lecture\ntags: \[giải-tích, toán\]\n---\n/);
  const tagged = (await readNote(api, LIMITS)).content;
  expect(tagged).not.toContain('giới-hạn');
  expect(tagged.slice(tagged.indexOf('# Giới hạn'))).toBe(saved.slice(saved.indexOf('# Giới hạn')));
});

test('Inbox note → Gợi ý chỗ để → Áp dụng moves and renames in one step; Hoàn tác restores it', async ({
  page,
}) => {
  const { mock, server } = app;
  const api = await server.api();
  const inbox = '0 Inbox/ghi nhanh 1.md';
  const content = 'Nhớ ôn chương giới hạn trước thứ sáu, làm lại bài 3 và bài 5.\n';
  await api.send('POST', '/api/note', { path: inbox, content });
  mock.reply(
    'placement',
    JSON.stringify({
      folder: '2 Areas',
      title: 'Ôn chương giới hạn',
      reason: 'Đây là việc ôn tập của một môn học.',
      keep: false,
    }),
  );
  await page.goto(`${server.origin}/${noteHash(inbox)}`);
  await expect(noteTitle(page)).toHaveValue('ghi nhanh 1');
  expect(mock.requestsOf('placement')).toHaveLength(0);
  await page.getByRole('button', { name: 'Gợi ý chỗ để' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gợi ý chỗ để' });
  await expect(dialog.getByRole('checkbox', { name: 'Chuyển đến 2 Areas' })).toBeChecked();
  await expect(
    dialog.getByRole('checkbox', { name: 'Đổi tên thành “Ôn chương giới hạn”' }),
  ).toBeChecked();
  expect(mock.requestsOf('placement')).toHaveLength(1);
  expect(mock.requestsOf('placement')[0]!.user).toContain('Nhớ ôn chương giới hạn');
  await shot(page, 'ai-inbox-placement-1280');
  await dialog.getByRole('button', { name: 'Áp dụng' }).click();

  const moved = '2 Areas/Ôn chương giới hạn.md';
  const onDisk = (p: string) => existsSync(path.join(server.vaultDir, ...p.split('/')));
  await expect.poll(() => onDisk(moved)).toBe(true);
  expect(onDisk(inbox)).toBe(false);
  expect((await readNote(api, moved)).content).toBe(content);
  const toast = page.getByRole('status').filter({
    hasText: 'Đã chuyển “ghi nhanh 1” đến 2 Areas và đổi tên thành “Ôn chương giới hạn”.',
  });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Hoàn tác' }).click();
  await expect.poll(() => onDisk(inbox)).toBe(true);
  expect(onDisk(moved)).toBe(false);
  expect((await readNote(api, inbox)).content).toBe(content);
});
