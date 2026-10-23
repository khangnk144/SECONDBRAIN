/// <reference lib="dom" />
// Sidebar tree end to end, keyboard only (SPEC F2.2, F2.4): F2 renames with relink after the
// confirm dialog lists the linking note, Delete moves the note to the trash, and both undo
// through the journal from the 10 s toast. (In Bento the tree is the folder pane of a note route.)
import { expect, test } from '@playwright/test';
import { runStyle } from './helpers/e2e-style.js';
import { cleanupNotes, trackNote, vaultApi } from './helpers/vault-api.js';

test.afterEach(async ({ page }) => cleanupNotes(page));

test('rename with F2 and delete with Delete, both undone from the toast (F2.2)', async ({
  page,
}) => {
  const api = await vaultApi(page);
  await api.createNote('1 Projects/Cây e2e.md', '# Cây\n');
  await api.createNote('1 Projects/Liên kết cây.md', 'Xem [[Cây e2e]].\n');
  if (runStyle() === 'bento') {
    // Bento shows the tree in the folder pane beside the rail on note routes: open a third note.
    const other = '0 Inbox/Mở cây e2e.md';
    await api.createNote(other, '# Mở cây\n');
    await page.goto(`/#/note?path=${encodeURIComponent(other)}`);
  } else {
    await page.goto('/');
  }
  await page.reload();

  const tree = page.getByRole('tree');
  const item = tree.getByRole('treeitem', { name: /^Cây e2e/ });
  await expect(item).toBeVisible();
  await item.focus();

  // F2 → inline rename → Enter → the dialog lists the linking note → "Đổi tên".
  await page.keyboard.press('F2');
  const input = tree.getByRole('textbox');
  await expect(input).toBeFocused();
  trackNote('1 Projects/Cây đã đổi.md');
  await input.fill('Cây đã đổi');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Liên kết cây');
  await dialog.getByRole('button', { name: 'Đổi tên', exact: true }).click();
  await expect
    .poll(async () => (await api.tryRead('1 Projects/Cây đã đổi.md'))?.content)
    .toBe('# Cây\n');
  expect((await api.readNote('1 Projects/Liên kết cây.md')).content).toBe('Xem [[Cây đã đổi]].\n');
  await page.getByRole('button', { name: 'Hoàn tác' }).click();
  await expect
    .poll(async () => (await api.tryRead('1 Projects/Cây e2e.md'))?.content)
    .toBe('# Cây\n');
  // Undo is journaled: the linking note is put back by its own step.
  await expect
    .poll(async () => (await api.readNote('1 Projects/Liên kết cây.md')).content)
    .toBe('Xem [[Cây e2e]].\n');

  // Delete → trash → undo brings the file back.
  const restored = tree.getByRole('treeitem', { name: /^Cây e2e/ });
  await expect(restored).toBeVisible();
  await restored.focus();
  await page.keyboard.press('Delete');
  await expect.poll(async () => api.tryRead('1 Projects/Cây e2e.md')).toBeNull();
  await page.getByRole('button', { name: 'Hoàn tác' }).click();
  await expect
    .poll(async () => (await api.tryRead('1 Projects/Cây e2e.md'))?.content)
    .toBe('# Cây\n');
});
