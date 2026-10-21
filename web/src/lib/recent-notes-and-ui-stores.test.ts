import { beforeEach, describe, expect, it } from 'vitest';
import { useCaptureUi } from './capture-ui-store';
import {
  MAX_RECENT_NOTES,
  recentNotePaths,
  startRecentNotesSync,
  useRecentNotes,
} from './recent-notes-store';
import { useShortcutSheetUi } from './shortcut-sheet-store';
import { resetAppState } from './testing/reset-app-state';
import { useVaultStore } from './vault-store';
import { emitServerEvent } from './ws/server-event-bus';

const recent = () => useRecentNotes.getState();

describe('recently opened notes (F8 empty query)', () => {
  beforeEach(async () => {
    await resetAppState('vault-a');
  });

  it('keeps the most recent first, once per note, at most 50', () => {
    recent().record('a.md');
    recent().record('2 Areas/Giải tích 1.md');
    recent().record('A.md'); // same file on Windows: moves to the front, no duplicate
    expect(recent().paths).toEqual(['A.md', '2 Areas/Giải tích 1.md']);
    for (let i = 0; i < 60; i += 1) recent().record(`0 Inbox/n${i}.md`);
    expect(recent().paths).toHaveLength(MAX_RECENT_NOTES);
    expect(recentNotePaths(3)).toEqual(['0 Inbox/n59.md', '0 Inbox/n58.md', '0 Inbox/n57.md']);
  });

  it('is remembered per vault', () => {
    recent().record('1 Projects/Đồ án Giải tích.md');
    useVaultStore.setState({ vaultId: 'vault-b' });
    recent().hydrate();
    expect(recent().paths).toEqual([]);
    recent().record('b.md');
    useVaultStore.setState({ vaultId: 'vault-a' });
    recent().hydrate();
    expect(recent().paths).toEqual(['1 Projects/Đồ án Giải tích.md']);
  });

  it('follows renames (also of a folder, one event per file) and drops deleted notes', () => {
    const stop = startRecentNotesSync();
    recent().record('2 Areas/Cũ/Bài 1.md');
    recent().record('0 Inbox/Ý tưởng.md');
    recent().record('0 Inbox/Xóa.md');
    emitServerEvent({
      type: 'note:renamed',
      path: '2 Areas/Mới/Bài 1.md',
      oldPath: '2 Areas/Cũ/Bài 1.md',
      revision: 'r',
    });
    emitServerEvent({ type: 'note:deleted', path: '0 Inbox/Xóa.md' });
    stop();
    expect(recent().paths).toEqual(['0 Inbox/Ý tưởng.md', '2 Areas/Mới/Bài 1.md']);
    useRecentNotes.setState({ paths: [] });
    recent().hydrate();
    expect(recent().paths).toEqual(['0 Inbox/Ý tưởng.md', '2 Areas/Mới/Bài 1.md']);
  });
});

describe('overlay UI stores', () => {
  beforeEach(async () => {
    await resetAppState();
    document.body.innerHTML = '';
  });

  it('capture remembers the focused element and gives focus back on close (F12.1)', () => {
    const field = document.createElement('input');
    const overlayInput = document.createElement('textarea');
    document.body.append(field, overlayInput);
    field.focus();
    useCaptureUi.getState().open();
    overlayInput.focus();
    useCaptureUi.getState().open(); // a second open keeps the first focus
    expect(useCaptureUi.getState().isOpen).toBe(true);
    useCaptureUi.getState().close();
    expect(useCaptureUi.getState().isOpen).toBe(false);
    expect(field).toHaveFocus();

    useCaptureUi.getState().open();
    overlayInput.focus();
    useCaptureUi.getState().close({ restoreFocus: false });
    expect(overlayInput).toHaveFocus();
  });

  it('shortcut sheet opens, closes and toggles', () => {
    const sheet = useShortcutSheetUi.getState();
    sheet.open();
    expect(useShortcutSheetUi.getState().isOpen).toBe(true);
    sheet.close();
    sheet.toggle();
    expect(useShortcutSheetUi.getState().isOpen).toBe(true);
    sheet.toggle();
    expect(useShortcutSheetUi.getState().isOpen).toBe(false);
  });
});
