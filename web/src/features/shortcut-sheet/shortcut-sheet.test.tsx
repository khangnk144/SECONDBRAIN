import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FORMATTING_COMMANDS } from '../../editor/formatting/formatting-commands';
import { i18n } from '../../i18n';
import { useShortcutSheetUi } from '../../lib/shortcut-sheet-store';
import { listShortcuts, registerShortcut } from '../../lib/shortcuts/shortcut-registry';
import { useAppShortcuts } from '../../lib/shortcuts/use-app-shortcuts';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { GRAPH_VIEW_KEYS } from '../graph/use-graph-view-keys';
import { comboParts } from './key-chips';
import { LOCAL_KEYS } from './local-keys';
import { CALENDAR_GRID_KEYS, EDITOR_CONTEXT_KEYS, TODAY_STRIP_KEYS } from './screen-keys';
import { ShortcutSheet } from './shortcut-sheet';
import { shortcutSheetGroups } from './shortcut-sheet-groups';

function Harness() {
  useAppShortcuts();
  return (
    <>
      <button type="button">opener</button>
      <ShortcutSheet />
    </>
  );
}

const sheet = () => screen.getByRole('dialog', { name: 'Phím tắt' });
const rowsOf = (groupName: string) =>
  within(within(sheet()).getByRole('region', { name: groupName }))
    .getAllByRole('listitem')
    .map((row) => row.textContent);
const rowText = (labelKey: string, keys: readonly string[]) =>
  `${i18n.t(labelKey)}${keys.join(' hoặc ')}`;

async function openWithKeys(user: ReturnType<typeof userEvent.setup>) {
  screen.getByRole('button', { name: 'opener' }).focus();
  await user.keyboard('{Control>}/{/Control}');
  return sheet();
}

describe('shortcut sheet (F22.2)', () => {
  beforeEach(async () => {
    await resetAppState();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Ctrl+/ opens it; the app group lists exactly the registered shortcuts', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openWithKeys(user);
    const expected = listShortcuts().map((s) => rowText(s.labelKey, [s.keys]));
    expect(rowsOf('Trong cả app')).toEqual(expected);
    expect(rowsOf('Trong cả app')).toContain('Ghi nhanh vào InboxAlt+Q');
    // Every key is a <kbd> chip.
    const first = within(sheet()).getAllByRole('listitem')[0];
    expect(first?.querySelectorAll('kbd')).toHaveLength(2);
  });

  it('follows the registry: a new registration appears, a removed one disappears', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const unregister = registerShortcut({
      id: 'tasks-test',
      keys: 'Alt+J',
      labelKey: 'commands.openTasks',
      run: () => undefined,
    });
    await openWithKeys(user);
    expect(rowsOf('Trong cả app')).toContain('Mở Việc cần làmAlt+J');
    await user.keyboard('{Escape}');
    unregister();
    await openWithKeys(user);
    expect(rowsOf('Trong cả app')).not.toContain('Mở Việc cần làmAlt+J');
    expect(rowsOf('Trong cả app')).toHaveLength(listShortcuts().length);
  });

  it('lists the editor keys of the formatting registry; source mode once, from the app registry', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openWithKeys(user);
    const editorRows = FORMATTING_COMMANDS.filter((c) => c.keys && !c.appShortcutId);
    expect(rowsOf('Khi viết ghi chú')).toEqual([
      ...editorRows.map((c) => rowText(c.labelKey, [c.keys ?? '', ...(c.altKeys ?? [])])),
      ...EDITOR_CONTEXT_KEYS.map((k) => rowText(k.labelKey, k.keys)),
    ]);
    // Ctrl+Enter ticks the task at the caret (the editor's Mod+Enter).
    expect(rowsOf('Khi viết ghi chú').at(-1)).toMatch(/^Đánh dấu việc ở con trỏ.*Ctrl\+Enter$/);
    expect(rowsOf('Khi viết ghi chú')).toContain('Làm lại chỉnh sửaCtrl+Y hoặc Ctrl+Shift+Z');
    expect(rowsOf('Khi viết ghi chú')).toContain('Gạch chânCtrl+U');
    // No note on screen: Alt+S is not registered, so the sheet does not offer it.
    const altS = () =>
      within(sheet())
        .getAllByRole('listitem')
        .map((row) => row.textContent)
        .filter((text) => text?.endsWith('Alt+S'));
    expect(altS()).toEqual([]);
    await user.keyboard('{Escape}');

    // While a note is shown, the note screen registers Alt+S in the app registry.
    registerShortcut({
      id: 'source-mode',
      keys: 'Alt+S',
      labelKey: 'note.source.shortcut',
      run: () => undefined,
    });
    await openWithKeys(user);
    expect(altS()).toEqual(['Bật hoặc tắt chế độ nguồnAlt+S']);
    expect(rowsOf('Trong cả app')).toContain('Bật hoặc tắt chế độ nguồnAlt+S');
  });

  it('documents the keys of single screens and the component-local keys', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openWithKeys(user);
    const rows = (list: ReadonlyArray<{ labelKey: string; keys: readonly string[] }>) =>
      list.map((k) => rowText(k.labelKey, k.keys));
    expect(rowsOf('Trên trang Hôm nay')).toEqual(rows(TODAY_STRIP_KEYS));
    expect(rowsOf('Trên trang Hôm nay')).toContain(
      'Sang ngày trước hoặc ngày sau trong dải ngày← hoặc →',
    );
    expect(rowsOf('Trong Lịch')).toEqual(rows(CALENDAR_GRID_KEYS));
    expect(rowsOf('Trong Lịch')).toContain('Sang tháng trước hoặc tháng sauPageUp hoặc PageDown');
    // The brain map's rows come from the list its key handler uses.
    expect(rowsOf('Trên Bản đồ não')).toEqual([
      'Về khung nhìn ban đầu0',
      'Phóng to+',
      'Thu nhỏ-',
      'Bỏ chọn ghi chúEsc',
    ]);
    expect(GRAPH_VIEW_KEYS).toHaveLength(4);
    const zoomIn = within(
      within(sheet()).getByRole('region', { name: 'Trên Bản đồ não' }),
    ).getAllByRole('listitem')[1];
    expect([...(zoomIn?.querySelectorAll('kbd') ?? [])].map((k) => k.textContent)).toEqual(['+']);
    expect(rowsOf('Ở các phần khác')).toEqual(rows(LOCAL_KEYS));
    expect(rowsOf('Ở các phần khác')).toContain('Đổi tên mục đang chọn trong cây thư mụcF2');
    expect(rowsOf('Ở các phần khác')).toContain(
      'Mở ghi chú đang chọn trong thẻ mới (cây thư mục, bảng tìm kiếm)Ctrl+Enter',
    );
  });

  it('splits key combinations, keeping a + key whole', () => {
    expect(comboParts('Ctrl+Shift+Z')).toEqual(['Ctrl', 'Shift', 'Z']);
    expect(comboParts('+')).toEqual(['+']);
    expect(comboParts('Ctrl++')).toEqual(['Ctrl', '+']);
    expect(comboParts('Esc')).toEqual(['Esc']);
  });

  it('traps focus, Esc closes it and focus goes back; shortcuts are off meanwhile', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'opener' });
    await openWithKeys(user);
    const list = within(sheet()).getByRole('region', { name: 'Danh sách phím tắt' });
    expect(list).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(sheet()).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Control>}/{/Control}');
    expect(useShortcutSheetUi.getState().isOpen).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
    act(() => useShortcutSheetUi.getState().open());
    await user.click(within(sheet()).getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('builds groups without empty ones', () => {
    expect(shortcutSheetGroups([], [], [], [], []).map((g) => g.id)).toEqual([]);
    const groups = shortcutSheetGroups(
      [{ id: 'source-mode', keys: 'Alt+S', labelKey: 'a' }],
      [{ id: 'sourceMode', keys: 'Alt+S', labelKey: 'b', appShortcutId: 'source-mode' }],
      [],
      [{ id: 'graph', titleKey: 'g', rows: [] }],
      [],
    );
    expect(groups.map((g) => [g.id, g.rows.map((r) => r.labelKey)])).toEqual([['app', ['a']]]);
    const noKeys = shortcutSheetGroups([], [{ id: 'divider', labelKey: 'c' }], [], [], []);
    expect(noKeys).toEqual([]);
    expect(shortcutSheetGroups([], [], []).map((g) => g.id)).toEqual([
      'editor',
      'today',
      'calendar',
      'graph',
    ]);
  });
});
