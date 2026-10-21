import { beforeEach, describe, expect, it, type Mock } from 'vitest';
import { fileRoute, noteRoute, TODAY_ROUTE, type Navigator } from './app-navigation';
import { handleShortcutKeydown, registerShortcut } from './shortcuts/shortcut-registry';
import { APP_SHORTCUTS } from './shortcuts/use-app-shortcuts';
import { MAX_TABS, tabRoute, useTabsStore } from './tabs-store';
import { startTabsSync } from './tabs-sync';
import { resetAppState } from './testing/reset-app-state';
import { useToastStore } from './toast-store';
import { emitServerEvent } from './ws/server-event-bus';

const PDF = '3 Resources/papers/bài giảng 3.pdf';
const tabs = () => useTabsStore.getState();
const summary = () => tabs().tabs.map((tab) => `${tab.kind}:${tab.path}`);
const activePath = () => tabs().tabs.find((tab) => tab.id === tabs().activeId)?.path;

describe('file tabs next to note tabs (F23.1, F15.3)', () => {
  let navigate: Mock<Navigator>;
  beforeEach(async () => {
    navigate = (await resetAppState('vault-a')) as Mock<Navigator>;
    tabs().setRouteActive(true);
  });

  it('opens a PDF in a file tab on the viewer route, beside or instead of the active tab', () => {
    tabs().openNote('0 Inbox/Ý tưởng.md');
    tabs().openFile(PDF, { newTab: true });
    expect(summary()).toEqual(['note:0 Inbox/Ý tưởng.md', `file:${PDF}`]);
    expect(navigate).toHaveBeenLastCalledWith(fileRoute(PDF), undefined);
    // Opening it again activates the same tab.
    tabs().activate(tabs().tabs[0]?.id ?? '');
    tabs().openFile(PDF, { newTab: true });
    expect(summary()).toHaveLength(2);
    expect(activePath()).toBe(PDF);
    // A plain open replaces the active tab, like a note link does.
    tabs().openNote('2 Areas/Giải tích 1.md');
    expect(summary()).toEqual(['note:0 Inbox/Ý tưởng.md', 'note:2 Areas/Giải tích 1.md']);
    expect(tabRoute({ kind: 'file', path: PDF })).toBe(fileRoute(PDF));
    expect(tabRoute({ path: 'a.md' })).toBe(noteRoute('a.md'));
  });

  it('Alt+W, activation and the last-tab rule work the same for a file tab', () => {
    const stopSync = startTabsSync();
    tabs().openNote('a.md');
    tabs().openFile(PDF, { newTab: true });
    tabs().activate(tabs().tabs[0]?.id ?? '');
    tabs().activateNext();
    expect(navigate).toHaveBeenLastCalledWith(fileRoute(PDF), undefined);
    tabs().closeActiveTab();
    expect(summary()).toEqual(['note:a.md']);
    expect(navigate).toHaveBeenLastCalledWith(noteRoute('a.md'), undefined);
    tabs().openFile(PDF);
    tabs().closeActiveTab();
    expect(summary()).toEqual([]);
    expect(navigate).toHaveBeenLastCalledWith(TODAY_ROUTE, undefined);
    stopSync();
  });

  it('the shortcut Alt+W closes the file tab on screen', () => {
    const close = APP_SHORTCUTS.find((shortcut) => shortcut.id === 'close-tab');
    const unregister = registerShortcut({ ...close! });
    tabs().openFile(PDF);
    const event = new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', altKey: true });
    expect(handleShortcutKeydown(event)).toBe(true);
    expect(summary()).toEqual([]);
    unregister();
  });

  it('a file tab counts toward the 20-tab limit', () => {
    for (let i = 1; i < MAX_TABS; i += 1) tabs().openNote(`n/Bài ${i}.md`, { newTab: true });
    tabs().openFile(PDF, { newTab: true });
    tabs().openNote('n/Bài 21.md', { newTab: true });
    expect(summary()).toHaveLength(MAX_TABS);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('Bài 1');
  });

  it('saves the kind per vault; tabs saved before kinds existed load as notes', () => {
    tabs().openNote('a.md');
    tabs().openFile(PDF, { newTab: true });
    const saved = JSON.parse(localStorage.getItem('sb:vault-a:tabs') ?? '{}') as {
      tabs: { kind: string }[];
    };
    expect(saved.tabs.map((tab) => tab.kind)).toEqual(['note', 'file']);

    localStorage.setItem(
      'sb:vault-a:tabs',
      JSON.stringify({
        tabs: [
          { id: 'old', path: '0 Inbox/Cũ.md', lastActive: 3 },
          { id: 'pdf', kind: 'file', path: PDF, lastActive: 4 },
          { id: 'odd', kind: 'video', path: 'x.mp4', lastActive: 5 },
        ],
        activeId: 'pdf',
      }),
    );
    useTabsStore.setState({ tabs: [], activeId: null, hydrated: false });
    tabs().hydrate();
    expect(summary()).toEqual(['note:0 Inbox/Cũ.md', `file:${PDF}`]);
    expect(tabs().activeId).toBe('pdf');
  });

  it('mirrors a /file deep link into a file tab without navigating', () => {
    tabs().syncFromRoute('a.md');
    navigate.mockClear();
    tabs().syncFromRoute(PDF, 'file');
    expect(summary()).toEqual([`file:${PDF}`]);
    tabs().syncFromRoute(PDF, 'file');
    expect(summary()).toHaveLength(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a file tab follows a rename and stays open (missing state) when the file is deleted', () => {
    const stopSync = startTabsSync();
    tabs().openFile(PDF);
    emitServerEvent({
      type: 'note:renamed',
      oldPath: PDF,
      path: '3 Resources/papers/Bài giảng 3 (mới).pdf',
      revision: 'r',
    });
    expect(summary()).toEqual(['file:3 Resources/papers/Bài giảng 3 (mới).pdf']);
    expect(navigate).toHaveBeenLastCalledWith(
      fileRoute('3 Resources/papers/Bài giảng 3 (mới).pdf'),
      { replace: true },
    );
    emitServerEvent({ type: 'note:deleted', path: '3 Resources/papers/Bài giảng 3 (mới).pdf' });
    expect(summary()).toHaveLength(1);
    expect(useToastStore.getState().toasts).toEqual([]);
    stopSync();
  });
});
