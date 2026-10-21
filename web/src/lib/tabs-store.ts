import { create } from 'zustand';
import { i18n } from '../i18n';
import type { VaultPath } from './api/vault-types';
import { navigateTo, noteRoute, TODAY_ROUTE } from './app-navigation';
import { loadTabs, saveTabs, type NoteTab } from './tabs-persistence';
import { showToast } from './toast-store';
import { isInsideFolder, noteTitleFromPath, replacePathPrefix, samePath } from './vault-paths';

export type { NoteTab } from './tabs-persistence';
export const MAX_TABS = 20;

export interface OpenNoteOptions {
  /** Ctrl+click, middle-click, Ctrl+Enter: open beside the current tab instead of replacing it. */
  newTab?: boolean;
  /** Freshly created note: the note screen focuses and selects the title. */
  isNew?: boolean;
  /** Caret position from a template's `{{cursor}}` (UTF-16 offset in the file). */
  cursor?: number | null;
}

interface TabsState {
  tabs: NoteTab[];
  activeId: string | null;
  /** Saved tabs of the current vault have been read. */
  hydrated: boolean;
  /** The note route is on screen (closing the active tab then navigates). */
  routeActive: boolean;
  hydrate: () => void;
  setRouteActive: (active: boolean) => void;
  openNote: (path: VaultPath, options?: OpenNoteOptions) => void;
  /** The route changed to `#/note?path=` (deep link, back/forward): mirror it without navigating. */
  syncFromRoute: (path: VaultPath) => void;
  activate: (id: string) => void;
  closeTab: (id: string) => void;
  closeActiveTab: () => void;
  activateNext: () => void;
  activatePrevious: () => void;
  /** A note or folder moved: every tab at or below `oldPath` follows it. */
  renamePath: (oldPath: VaultPath, newPath: VaultPath) => void;
  /** Closes the tabs of these notes (`notify` = tell the user why, for deletions from outside). */
  closePaths: (paths: VaultPath[], options?: { notify?: boolean }) => void;
  /** Closes every tab below a folder (folder trashed). */
  closeFolder: (folder: VaultPath) => void;
}

let clock = 0;
let idSeq = 0;
/** Removals the app itself started (trash): their WS deletion events need no toast. */
let expectedRemovals: { matches: (path: VaultPath) => boolean; until: number }[] = [];
const EXPECTED_REMOVAL_MS = 30_000;

/** Announces that the app is about to delete these notes or everything below `folder`. */
export function expectTabRemoval(paths: VaultPath[], folder?: VaultPath): void {
  const now = Date.now();
  expectedRemovals = expectedRemovals.filter((entry) => entry.until > now);
  expectedRemovals.push({
    until: now + EXPECTED_REMOVAL_MS,
    matches: (path) =>
      paths.some((p) => samePath(p, path)) ||
      (folder !== undefined && isInsideFolder(path, folder)),
  });
}

function wasExpected(path: VaultPath): boolean {
  const now = Date.now();
  return expectedRemovals.some((entry) => entry.until > now && entry.matches(path));
}

const newId = () => `tab-${Date.now().toString(36)}-${++idSeq}`;
const activeTab = (s: Pick<TabsState, 'tabs' | 'activeId'>) =>
  s.tabs.find((tab) => tab.id === s.activeId) ?? null;

export const useTabsStore = create<TabsState>((set, get) => {
  function commit(tabs: NoteTab[], activeId: string | null) {
    set({ tabs, activeId });
    if (get().hydrated) saveTabs({ tabs, activeId });
  }

  function touch(tabs: NoteTab[], id: string): NoteTab[] {
    clock += 1;
    return tabs.map((tab) => (tab.id === id ? { ...tab, lastActive: clock } : tab));
  }

  /** Puts `path` in the tab set (no navigation); returns nothing, the state says the rest. */
  function place(path: VaultPath, newTab: boolean) {
    const { tabs, activeId } = get();
    const existing = tabs.find((tab) => samePath(tab.path, path));
    if (existing) return commit(touch(tabs, existing.id), existing.id);
    const active = activeTab(get());
    if (!newTab && active) {
      const replaced = tabs.map((tab) => (tab.id === active.id ? { ...tab, path } : tab));
      return commit(touch(replaced, active.id), active.id);
    }
    const tab: NoteTab = { id: newId(), path, lastActive: 0 };
    let next = [...tabs, tab];
    if (tabs.length >= MAX_TABS) {
      const victim = tabs
        .filter((t) => t.id !== activeId)
        .reduce((a, b) => (b.lastActive < a.lastActive ? b : a));
      next = tabs.map((t) => (t.id === victim.id ? tab : t));
      showToast({
        message: i18n.t('tabs.limitReplaced', {
          title: noteTitleFromPath(victim.path),
          max: MAX_TABS,
        }),
      });
    }
    commit(touch(next, tab.id), tab.id);
  }

  function closeWhere(predicate: (tab: NoteTab) => boolean, notify: boolean) {
    const { tabs, activeId, routeActive } = get();
    const closing = tabs.filter(predicate);
    if (closing.length === 0) return;
    const remaining = tabs.filter((tab) => !predicate(tab));
    let nextActive = activeId;
    if (closing.some((tab) => tab.id === activeId)) {
      const index = tabs.findIndex((tab) => tab.id === activeId);
      // Browser-like: the right neighbour takes over, else the left one.
      const after = tabs.slice(index + 1).find((tab) => !predicate(tab));
      const before = [...tabs.slice(0, index)].reverse().find((tab) => !predicate(tab));
      nextActive = (after ?? before)?.id ?? null;
    }
    commit(nextActive ? touch(remaining, nextActive) : remaining, nextActive);
    if (notify) {
      for (const tab of closing.filter((t) => !wasExpected(t.path))) {
        showToast({
          message: i18n.t('tabs.closedDeleted', { title: noteTitleFromPath(tab.path) }),
        });
      }
    }
    if (routeActive && nextActive !== activeId) {
      const next = activeTab(get());
      navigateTo(next ? noteRoute(next.path) : TODAY_ROUTE);
    }
  }

  function step(delta: 1 | -1) {
    const { tabs, activeId, routeActive } = get();
    if (!routeActive || tabs.length < 2) return;
    const index = tabs.findIndex((tab) => tab.id === activeId);
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) get().activate(next.id);
  }

  return {
    tabs: [],
    activeId: null,
    hydrated: false,
    routeActive: false,
    hydrate: () => {
      const saved = loadTabs(MAX_TABS);
      clock = Math.max(clock, ...saved.tabs.map((tab) => tab.lastActive));
      set({ tabs: saved.tabs, activeId: saved.activeId, hydrated: true });
    },
    setRouteActive: (routeActive) => {
      if (get().routeActive !== routeActive) set({ routeActive });
    },
    openNote: (path, options = {}) => {
      place(path, options.newTab === true);
      navigateTo(noteRoute(path, { isNew: options.isNew, cursor: options.cursor }));
    },
    syncFromRoute: (path) => {
      const active = activeTab(get());
      if (active && samePath(active.path, path)) return;
      place(path, false);
    },
    activate: (id) => {
      const tab = get().tabs.find((t) => t.id === id);
      if (!tab) return;
      commit(touch(get().tabs, id), id);
      navigateTo(noteRoute(tab.path));
    },
    closeTab: (id) => closeWhere((tab) => tab.id === id, false),
    closeActiveTab: () => {
      const { activeId, routeActive } = get();
      if (routeActive && activeId) get().closeTab(activeId);
    },
    activateNext: () => step(1),
    activatePrevious: () => step(-1),
    renamePath: (oldPath, newPath) => {
      const before = activeTab(get());
      const tabs = get().tabs.map((tab) => ({
        ...tab,
        path: replacePathPrefix(tab.path, oldPath, newPath),
      }));
      if (tabs.every((tab, i) => tab.path === get().tabs[i]?.path)) return;
      commit(tabs, get().activeId);
      const after = activeTab(get());
      // Keep the address bar on the note the active tab now shows.
      if (get().routeActive && before && after && before.path !== after.path) {
        navigateTo(noteRoute(after.path), { replace: true });
      }
    },
    closePaths: (paths, options = {}) =>
      closeWhere((tab) => paths.some((p) => samePath(p, tab.path)), options.notify === true),
    closeFolder: (folder) => closeWhere((tab) => isInsideFolder(tab.path, folder), false),
  };
});
