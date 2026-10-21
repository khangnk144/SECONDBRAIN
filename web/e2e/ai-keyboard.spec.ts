/// <reference lib="dom" />
// The M6 AI surfaces without a mouse (SPEC F22, design.md §8): from the Ask screen's "AI chưa
// bật" state to the AI settings, the consent dialog (focus starts on "Để sau", Tab stays inside,
// Esc means "Để sau" and gives focus back), the key saved with Enter; the Ask screen opened from
// the palette ("Hỏi AI…"), a question sent with Enter and an answer link opened with Enter; and
// the editor's AI menu (Alt+A → Tóm tắt → Chèn bên dưới). No click, no mouse: Tab, arrows,
// Enter, Space, Esc only. App and mock of their own.
import { expect, test, type Page } from '@playwright/test';
import { FAKE_ANTHROPIC_KEY, startAiApp, type AiApp } from './helpers/ai-app.js';
import {
  appReady,
  expectFocus,
  pressUntilFocused,
  pressUntilLocatorFocused,
  settled,
} from './helpers/keyboard.js';
import { noteHash, noteTitle } from './helpers/note-page.js';
import { UTF8_BROWSER } from './helpers/own-server.js';

test.use(UTF8_BROWSER);

let app: AiApp;
test.beforeEach(async () => {
  app = await startAiApp();
});
test.afterEach(async () => {
  expect(app.mock.failures).toEqual([]);
  await app.dispose();
});

const NOTE = '2 Areas/Ôn tập chuỗi số.md';
const NOTE_TEXT = '# Ôn tập chuỗi số\n\nChuỗi hội tụ khi tổng riêng có giới hạn.\n\nCâu thứ hai.\n';
const SUMMARY = 'Chuỗi hội tụ nếu tổng riêng có giới hạn.';
const focusedText = (page: Page) =>
  page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');

test('keyboard only: AI settings and consent dialog, the Ask screen, the editor AI menu', async ({
  page,
}) => {
  test.slow();
  const { mock, server } = app;
  const api = await server.api();
  await api.send('POST', '/api/note', { path: NOTE, content: NOTE_TEXT });

  // Ask screen while AI is off → "Mở Cài đặt AI" → the AI section of Settings.
  await page.goto(`${server.origin}/#/ask`);
  await appReady(page);
  await expect(page.getByText('AI chưa bật. Bạn bật được trong Cài đặt, mục AI.')).toBeVisible();
  await pressUntilLocatorFocused(page, page.getByRole('button', { name: 'Mở Cài đặt AI' }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/settings/);
  const enable = '[role="switch"][aria-describedby="settings-ai-enable-hint"]';
  await pressUntilFocused(page, enable, { max: 20 });

  // The consent dialog: opens on "Để sau", Tab stays inside, Esc = "Để sau" and focus returns.
  await page.keyboard.press('Space');
  const consent = page.getByRole('dialog', { name: 'Bật AI với Anthropic (Claude)?' });
  await expect(consent).toBeVisible();
  await expect(consent.getByRole('button', { name: 'Để sau' })).toBeFocused();
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    expect(await consent.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(consent).toHaveCount(0);
  await expectFocus(page, enable);
  await expect(page.locator(enable)).not.toBeChecked();
  await page.keyboard.press('Space');
  await expect(consent.getByRole('button', { name: 'Để sau' })).toBeFocused();
  await pressUntilLocatorFocused(page, consent.getByRole('button', { name: 'Đồng ý và bật' }), {
    max: 6,
  });
  await page.keyboard.press('Enter');
  await expect(consent).toHaveCount(0);
  await expect(page.locator(enable)).toBeChecked();

  // The key: Tab to its field, type, Enter saves.
  await pressUntilFocused(page, 'input[aria-describedby]:not([type="checkbox"])', { max: 10 });
  await expect(page.getByLabel('Khóa API Anthropic (Claude)')).toBeFocused();
  await page.keyboard.type(FAKE_ANTHROPIC_KEY);
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('AI đang bật với Anthropic (Claude), mô hình claude-haiku-5-5.'),
  ).toBeVisible();

  // The palette's "Hỏi AI…" opens the Ask screen with the caret in the box; Enter sends.
  mock.reply('answer', 'Chuỗi hội tụ khi tổng riêng có giới hạn [S1].');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('>hỏi');
  const active = page.locator('.palette-option[aria-selected="true"] .palette-option__title');
  for (let i = 0; i < 12 && (await active.textContent())?.trim() !== 'Hỏi AI…'; i += 1) {
    await page.keyboard.press('ArrowDown');
  }
  await expect(active).toHaveText('Hỏi AI…');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/ask/);
  await expect(page.getByRole('textbox', { name: 'Câu hỏi của bạn' })).toBeFocused();
  await page.keyboard.type('Khi nào chuỗi hội tụ?');
  await page.keyboard.press('Enter');
  const answer = page.locator('li.ai-chat__turn--ai').last();
  await expect(answer.locator('.ai-answer a')).toHaveCount(1);
  await pressUntilFocused(page, '.ai-answer a', { key: 'Shift+Tab', max: 10 });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`path=${encodeURIComponent(NOTE)}`));

  // The editor: select a line with the keyboard, Alt+A, Tóm tắt, Chèn bên dưới.
  mock.reply('summarize', SUMMARY);
  await page.goto(`${server.origin}/${noteHash(NOTE)}`);
  await expect(noteTitle(page)).toHaveValue('Ôn tập chuỗi số');
  await pressUntilFocused(page, '.ProseMirror', { max: 40 });
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await settled(page);
  await page.keyboard.press('Shift+End');
  await settled(page);
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(
    'Chuỗi hội tụ khi tổng riêng có giới hạn.',
  );
  await page.keyboard.press('Alt+a');
  const menu = page.getByRole('menu', { name: 'AI cho đoạn đã chọn' });
  await expect(menu).toBeVisible();
  await expect.poll(() => focusedText(page)).toBe('Tóm tắt');
  await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog', { name: /Tóm tắt/ });
  await expect(panel.getByRole('button', { name: 'Chèn bên dưới' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveCount(0);
  await expectFocus(page, '.ProseMirror');
  await expect
    .poll(async () => {
      const note = await api.get<{ content: string }>(`/api/note?path=${encodeURIComponent(NOTE)}`);
      return note.content;
    })
    .toBe(
      `# Ôn tập chuỗi số\n\nChuỗi hội tụ khi tổng riêng có giới hạn.\n\n> **Tóm tắt (AI):** ${SUMMARY}\n\nCâu thứ hai.\n`,
    );
});
