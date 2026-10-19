/// <reference lib="dom" />
// Writing and linking notes in a real browser (SPEC S3a): new note from a template with Alt+N,
// Markdown typed as you write, a [[ link picked from the popup, autosave confirmed by the server,
// and the course note's backlinks listing the lecture.
import { expect, test, type Page } from '@playwright/test';
import { cleanupNotes, trackNote, vaultApi } from './helpers/vault-api.js';

test.afterEach(async ({ page }) => cleanupNotes(page));

const noteBody = (page: Page) => page.getByRole('textbox', { name: /Nội dung ghi chú/ });
const noteTitle = (page: Page) => page.getByRole('textbox', { name: /Tiêu đề ghi chú/ });
const noteUrl = (path: string) => `/#/note?path=${encodeURIComponent(path)}`;

/**
 * Ctrl+End right after the editor got focus can fire before the browser has put the caret inside
 * it (then nothing moves); press again until the caret really sits in the last block.
 */
async function caretToEnd(page: Page) {
  await expect
    .poll(async () => {
      await page.keyboard.press('Control+End');
      return page.evaluate(() => {
        const last = document.querySelector('.ProseMirror')?.lastElementChild;
        const anchor = document.getSelection()?.anchorNode ?? null;
        return Boolean(last && anchor && last.contains(anchor));
      });
    })
    .toBe(true);
}

test('S3a: write a lecture with Markdown shortcuts and a [[ link, then see it in backlinks', async ({
  page,
}) => {
  const api = await vaultApi(page);
  await api.createNote('2 Areas/Giải tích 1.md', '---\ntype: course\n---\n\n# Giải tích 1\n');
  await page.goto('/');
  await page.reload();

  // Alt+N → template picker → "Lecture" → the new note opens with its title selected.
  await page.keyboard.press('Alt+n');
  const picker = page.getByRole('listbox');
  await expect(picker).toBeFocused();
  await picker.getByRole('option', { name: /Lecture/ }).click();
  await expect(noteTitle(page)).toBeFocused();
  await page.keyboard.type('Bài 1 Đạo hàm');
  trackNote('0 Inbox/Bài 1 Đạo hàm.md');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/Ba%CC%80i%201|B%C3%A0i%201/);

  // Naming the note moves the caret into the body; type at its end: heading, bold, a task, then
  // a [[ link chosen from the popup.
  await expect(noteBody(page)).toBeFocused();
  await caretToEnd(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Đạo hàm');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Định nghĩa **quan trọng** cần nhớ');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- [ ] Làm bài tập 1');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Xem [[giai tich');
  const option = page.getByRole('option', { name: /Giải tích 1/ });
  await expect(option).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(noteBody(page).locator('h2', { hasText: 'Đạo hàm' })).toBeVisible();
  await expect(noteBody(page).locator('strong', { hasText: 'quan trọng' })).toBeVisible();
  await expect(noteBody(page).getByRole('checkbox')).toHaveCount(1);
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible({ timeout: 5_000 });

  const saved = await api.readNote('0 Inbox/Bài 1 Đạo hàm.md');
  expect(saved.content).toContain('type: lecture');
  expect(saved.content).toContain('## Đạo hàm');
  expect(saved.content).toContain('Định nghĩa **quan trọng** cần nhớ');
  expect(saved.content).toContain('- [ ] Làm bài tập 1');
  expect(saved.content).toContain('Xem [[Giải tích 1]]');
  expect(saved.content).not.toContain('&#x');

  // The course note lists the lecture under "Liên kết đến đây".
  await page.goto(noteUrl('2 Areas/Giải tích 1.md'));
  const panel = page.getByRole('complementary', { name: 'Ngăn bên phải' });
  await expect(panel.getByText('Liên kết đến đây')).toBeVisible();
  const backlink = panel.getByRole('button', { name: /Bài 1 Đạo hàm/ });
  await expect(backlink).toBeVisible({ timeout: 5_000 });
  await expect(backlink.locator('mark')).toHaveText('[[Giải tích 1]]');
});

test('opening and closing a note never writes it (P1)', async ({ page }) => {
  const api = await vaultApi(page);
  const source =
    '---\r\ntitle: x # comment\r\n---\r\n\r\n* item _a_\r\n\r\n$x^2$ and <b>html</b>\r\n';
  const created = await api.createNote('1 Projects/Không đổi.md', source);
  await page.goto(noteUrl('1 Projects/Không đổi.md'));
  await expect(noteBody(page)).toContainText('item');
  await page.waitForTimeout(1_500);
  await page.goto('/');
  const after = await api.readNote('1 Projects/Không đổi.md');
  expect(after.revision).toBe(created.revision);
  expect(after.content).toBe(source);
});

test('renaming from the title lists the linking notes, rewrites their links and can be undone (F3.7)', async ({
  page,
}) => {
  const api = await vaultApi(page);
  await api.createNote('2 Areas/Xác suất.md', '# Xác suất\n');
  await api.createNote('0 Inbox/Bài XS.md', 'Học [[Xác suất]] và [[Xác suất|XS]].\n');
  await page.goto(noteUrl('2 Areas/Xác suất.md'));
  await expect(noteTitle(page)).toHaveValue('Xác suất');
  trackNote('2 Areas/Xác suất thống kê.md');
  await noteTitle(page).fill('Xác suất thống kê');
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Bài XS');
  await dialog.getByRole('button', { name: 'Đổi tên', exact: true }).click();
  await expect(page).toHaveURL(/X%C3%A1c%20su%E1%BA%A5t%20th%E1%BB%91ng%20k%C3%AA|Xa%CC%81c/);
  expect((await api.readNote('0 Inbox/Bài XS.md')).content).toBe(
    'Học [[Xác suất thống kê]] và [[Xác suất thống kê|XS]].\n',
  );
  expect(await api.tryRead('2 Areas/Xác suất.md')).toBeNull();

  // The toast offers undo for 10 s; undo puts the file name and both links back.
  await page.getByRole('button', { name: 'Hoàn tác' }).click();
  await expect
    .poll(async () => (await api.tryRead('2 Areas/Xác suất.md'))?.content ?? null)
    .toBe('# Xác suất\n');
  expect((await api.readNote('0 Inbox/Bài XS.md')).content).toBe(
    'Học [[Xác suất]] và [[Xác suất|XS]].\n',
  );
});
