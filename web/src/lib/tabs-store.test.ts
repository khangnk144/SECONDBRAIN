import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Navigator } from './app-navigation';
import { resetAppState } from './testing/reset-app-state';
import { expectTabRemoval, MAX_TABS, useTabsStore } from './tabs-store';
import { expectRecreate, RECREATE_GRACE_MS, startTabsSync } from './tabs-sync';
import { useToastStore } from './toast-store';
import { useVaultStore } from './vault-store';
import { emitServerEvent } from './ws/server-event-bus';

const tabs = () => useTabsStore.getState();
const paths = () => tabs().tabs.map((tab) => tab.path);
const activePath = () => tabs().tabs.find((tab) => tab.id === tabs().activeId)?.path;
const route = (path: string) => `/note?path=${encodeURIComponent(path)}`;
const toastMessages = () => useToastStore.getState().toasts.map((t) => t.message);

describe('tabs store (F23.1)', () => {
  let navigate: Mock<Navigator>;
  beforeEach(async () => {
    navigate = (await resetAppState('vault-a')) as Mock<Navigator>;
    tabs().setRouteActive(true);
  });

  it('opens the first note in a tab, then navigates the active tab unless a new tab is asked', () => {
    tabs().openNote('0 Inbox/Ý tưởng.md');
    expect(paths()).toEqual(['0 Inbox/Ý tưởng.md']);
    expect(navigate).toHaveBeenLastCalledWith(route('0 Inbox/Ý tưởng.md'), undefined);
    tabs().openNote('2 Areas/Giải tích 1.md');
    expect(paths()).toEqual(['2 Areas/Giải tích 1.md']);
    tabs().openNote('1 Projects/Đồ án.md', { newTab: true });
    expect(paths()).toEqual(['2 Areas/Giải tích 1.md', '1 Projects/Đồ án.md']);
    expect(activePath()).toBe('1 Projects/Đồ án.md');
    // A note that is already open is activated, never duplicated.
    tabs().openNote('2 areas/giải tích 1.md', { newTab: true });
    expect(paths()).toHaveLength(2);
    expect(activePath()).toBe('2 Areas/Giải tích 1.md');
  });

  it('adds &new=1 for freshly created notes', () => {
    tabs().openNote('0 Inbox/Ghi chú mới.md', { isNew: true });
    expect(navigate).toHaveBeenLastCalledWith(
      `${route('0 Inbox/Ghi chú mới.md')}&new=1`,
      undefined,
    );
  });

  it('keeps at most 20 tabs: the 21st replaces the least recently used one with a 4 s toast', () => {
    for (let i = 1; i <= MAX_TABS; i += 1) tabs().openNote(`n/Bài ${i}.md`, { newTab: true });
    // Use tab 1 again so tab 2 becomes the least recently used.
    tabs().activate(tabs().tabs[0]?.id ?? '');
    tabs().openNote('n/Bài 21.md', { newTab: true });
    expect(paths()).toHaveLength(MAX_TABS);
    expect(paths()).not.toContain('n/Bài 2.md');
    expect(paths()[1]).toBe('n/Bài 21.md');
    expect(activePath()).toBe('n/Bài 21.md');
    const toast = useToastStore.getState().toasts.at(-1);
    expect(toast?.message).toContain('Bài 2');
    expect(toast?.durationMs).toBe(4_000);
  });

  it('closing the active tab activates its neighbour; closing the last tab shows Today', () => {
    tabs().openNote('a.md');
    tabs().openNote('b.md', { newTab: true });
    tabs().openNote('c.md', { newTab: true });
    tabs().activate(tabs().tabs[1]?.id ?? '');
    tabs().closeActiveTab();
    expect(paths()).toEqual(['a.md', 'c.md']);
    expect(activePath()).toBe('c.md');
    expect(navigate).toHaveBeenLastCalledWith(route('c.md'), undefined);
    tabs().closeTab(tabs().tabs[1]?.id ?? '');
    expect(activePath()).toBe('a.md');
    tabs().closeActiveTab();
    expect(paths()).toEqual([]);
    expect(navigate).toHaveBeenLastCalledWith('/', undefined);
  });

  it('Alt+W and Alt+[ / Alt+] act only on the note route and wrap around', () => {
    tabs().openNote('a.md');
    tabs().openNote('b.md', { newTab: true });
    tabs().activateNext();
    expect(activePath()).toBe('a.md');
    tabs().activatePrevious();
    expect(activePath()).toBe('b.md');
    tabs().setRouteActive(false);
    tabs().activateNext();
    tabs().closeActiveTab();
    expect(activePath()).toBe('b.md');
    expect(paths()).toHaveLength(2);
  });

  it('persists tabs per vault and restores them after a reload', () => {
    tabs().openNote('a.md');
    tabs().openNote('b.md', { newTab: true });
    const saved = JSON.parse(localStorage.getItem('sb:vault-a:tabs') ?? '{}') as {
      tabs: { path: string }[];
    };
    expect(saved.tabs.map((t) => t.path)).toEqual(['a.md', 'b.md']);

    useTabsStore.setState({ tabs: [], activeId: null, hydrated: false });
    useVaultStore.setState({ vaultId: 'vault-b' });
    tabs().hydrate();
    expect(paths()).toEqual([]);
    tabs().openNote('vault-b-note.md');

    useVaultStore.setState({ vaultId: 'vault-a' });
    tabs().hydrate();
    expect(paths()).toEqual(['a.md', 'b.md']);
    expect(activePath()).toBe('b.md');
  });

  it('drops invalid saved entries', () => {
    localStorage.setItem(
      'sb:vault-a:tabs',
      JSON.stringify({
        tabs: [{ id: 'x', path: 'ok.md', lastActive: 1 }, { id: 1 }, null],
        activeId: 'gone',
      }),
    );
    tabs().hydrate();
    expect(paths()).toEqual(['ok.md']);
    expect(tabs().activeId).toBe('x');
  });

  it('mirrors the route without navigating (deep link, back/forward)', () => {
    tabs().syncFromRoute('a.md');
    expect(paths()).toEqual(['a.md']);
    tabs().openNote('b.md', { newTab: true });
    navigate.mockClear();
    tabs().syncFromRoute('a.md');
    expect(activePath()).toBe('a.md');
    tabs().syncFromRoute('c.md');
    expect(paths()).toEqual(['c.md', 'b.md']);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('follows renames and closes deleted notes with a toast (WS events)', () => {
    const stop = startTabsSync();
    tabs().openNote('2 Areas/Cũ/Bài 1.md');
    tabs().openNote('x.md', { newTab: true });
    tabs().activate(tabs().tabs[0]?.id ?? '');
    emitServerEvent({
      type: 'note:renamed',
      oldPath: '2 Areas/Cũ/Bài 1.md',
      path: '2 Areas/Mới/Bài 1.md',
      revision: 'r',
    });
    expect(paths()).toEqual(['2 Areas/Mới/Bài 1.md', 'x.md']);
    expect(navigate).toHaveBeenLastCalledWith(route('2 Areas/Mới/Bài 1.md'), { replace: true });

    emitServerEvent({ type: 'note:deleted', path: 'x.md' });
    expect(paths()).toEqual(['2 Areas/Mới/Bài 1.md']);
    expect(toastMessages().at(-1)).toContain('x');

    // A deletion the app started itself closes silently.
    const before = toastMessages().length;
    expectTabRemoval(['2 Areas/Mới/Bài 1.md']);
    emitServerEvent({ type: 'note:deleted', path: '2 Areas/Mới/Bài 1.md' });
    expect(paths()).toEqual([]);
    expect(toastMessages()).toHaveLength(before);
    stop();
  });

  it('(D2) a note the app replaces in place keeps its tab for a while; later deletions close it', () => {
    const stop = startTabsSync();
    const page = 'Học kỳ này.md';
    tabs().openNote(page);
    const now = Date.now();
    expectRecreate('học kỳ này.md'.normalize('NFD'), now);
    emitServerEvent({ type: 'note:deleted', path: page });
    expect(paths()).toEqual([page]);
    expect(activePath()).toBe(page);
    // Past the grace time a deletion closes the tab as usual.
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now + RECREATE_GRACE_MS + 1);
    emitServerEvent({ type: 'note:deleted', path: page });
    expect(paths()).toEqual([]);
    spy.mockRestore();
    stop();
  });

  it('closes every tab below a trashed folder and renames tabs below a moved folder', () => {
    tabs().openNote('A/one.md');
    tabs().openNote('A/sub/two.md', { newTab: true });
    tabs().openNote('B/three.md', { newTab: true });
    tabs().renamePath('A', 'C');
    expect(paths()).toEqual(['C/one.md', 'C/sub/two.md', 'B/three.md']);
    tabs().closeFolder('C');
    expect(paths()).toEqual(['B/three.md']);
  });
});
