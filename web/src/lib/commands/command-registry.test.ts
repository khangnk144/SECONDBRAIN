import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import type { Navigator } from '../app-navigation';
import { useCaptureUi } from '../capture-ui-store';
import { usePanesStore } from '../panes-store';
import { useShortcutSheetUi } from '../shortcut-sheet-store';
import { installShortcutListener, registerShortcut } from '../shortcuts/shortcut-registry';
import { APP_SHORTCUTS } from '../shortcuts/use-app-shortcuts';
import { useTabsStore } from '../tabs-store';
import { installFetchMock, type FetchMock } from '../testing/fetch-mock';
import { resetAppState } from '../testing/reset-app-state';
import { useToastStore } from '../toast-store';
import { emitServerEvent } from '../ws/server-event-bus';
import { matchCommands } from './command-matching';
import { APP_COMMANDS, availableCommands, commandKeys, type AppCommand } from './command-registry';
import { IMPLEMENTED_FEATURES } from './implemented-features';

let navigate: ReturnType<typeof vi.fn<Navigator>>;
let mock: FetchMock;

const command = (id: string): AppCommand => {
  const found = APP_COMMANDS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no command ${id}`);
  return found;
};
const toasts = () => useToastStore.getState().toasts.map((toast) => toast.message);

/** A note screen with three tabs, the middle one active (tab commands need a note on screen). */
function noteScreenWithTabs() {
  useTabsStore.setState({
    tabs: [
      { id: 'a', path: 'a/Một.md', lastActive: 1 },
      { id: 'b', path: 'b/Hai.md', lastActive: 3 },
      { id: 'c', path: 'c/Ba.md', lastActive: 2 },
    ],
    activeId: 'b',
    routeActive: true,
  });
}

/** What running each command must do. A new command without an entry here fails the test. */
const EFFECTS: Record<string, () => Promise<void> | void> = {
  'new-note': async () => {
    await vi.waitFor(() => expect(mock.callsTo('POST /api/note')).toHaveLength(1));
  },
  'daily-note': async () => {
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        `/note?path=${encodeURIComponent('Daily/x.md')}`,
        undefined,
      ),
    );
  },
  'quick-capture': () => expect(useCaptureUi.getState().isOpen).toBe(true),
  openToday: () => expect(navigate).toHaveBeenLastCalledWith('/', undefined),
  openTasks: () => expect(navigate).toHaveBeenLastCalledWith('/tasks', undefined),
  openCalendar: () => expect(navigate).toHaveBeenLastCalledWith('/calendar', undefined),
  graph: () => expect(navigate).toHaveBeenLastCalledWith('/graph', undefined),
  openTags: () => expect(navigate).toHaveBeenLastCalledWith('/tags', undefined),
  'shortcut-sheet': () => expect(useShortcutSheetUi.getState().isOpen).toBe(true),
  'toggle-left-pane': () => expect(usePanesStore.getState().leftCollapsed).toBe(true),
  'toggle-right-pane': () => expect(usePanesStore.getState().rightCollapsed).toBe(true),
  'source-mode': () => expect(sourceToggle).toHaveBeenCalledTimes(1),
  'close-tab': () => expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(['a', 'c']),
  'previous-tab': () => expect(useTabsStore.getState().activeId).toBe('a'),
  'next-tab': () => expect(useTabsStore.getState().activeId).toBe('c'),
  'rebuild-index': async () => {
    await vi.waitFor(() => expect(mock.callsTo('POST /api/index/rebuild')).toHaveLength(1));
    await vi.waitFor(() => expect(toasts()).toContain(i18n.t('commands.rebuildStarted')));
    emitServerEvent({ type: 'index:progress', phase: 'done', done: 3, total: 3 });
    expect(toasts()).toContain(i18n.t('commands.rebuildDone'));
  },
};

const sourceToggle = vi.fn();

describe('command registry (F8.4)', () => {
  beforeEach(async () => {
    navigate = (await resetAppState()) as ReturnType<typeof vi.fn<Navigator>>;
    mock = installFetchMock();
    mock.on('GET /api/templates', { body: { templates: [], missingBundled: [] } });
    mock.on('POST /api/note', (call) => ({
      body: { path: (call.body as { path: string }).path, revision: 'r1' },
    }));
    mock.on('GET /api/daily', { body: { path: 'Daily/x.md', revision: 'r' } });
    mock.on('POST /api/index/rebuild', { status: 202, body: { started: true } });
    sourceToggle.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('references only features this build has and has a label in both languages', () => {
    const ids = APP_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of APP_COMMANDS) {
      expect(IMPLEMENTED_FEATURES, c.id).toContain(c.feature);
      expect(i18n.exists(c.labelKey, { lng: 'vi' }), c.labelKey).toBe(true);
      expect(i18n.exists(c.labelKey, { lng: 'en' }), c.labelKey).toBe(true);
    }
    // "Hỏi AI…" arrives with the AI phase.
    expect(APP_COMMANDS.some((c) => c.feature === 'ai')).toBe(false);
  });

  it('hides a command whose feature is not implemented, or that cannot run here', () => {
    const ask: AppCommand = { ...command('openToday'), id: 'ask-ai', feature: 'ai' };
    expect(availableCommands([...APP_COMMANDS, ask]).map((c) => c.id)).not.toContain('ask-ai');
    const visible = availableCommands().map((c) => c.id);
    for (const id of ['source-mode', 'close-tab', 'previous-tab', 'next-tab']) {
      expect(visible).not.toContain(id);
    }
    noteScreenWithTabs();
    registerShortcut({ id: 'source-mode', keys: 'Alt+S', run: sourceToggle, labelKey: 'x' });
    expect(availableCommands()).toHaveLength(APP_COMMANDS.length);
  });

  it('shows the key of its shortcut, read from the shortcut registry', () => {
    for (const shortcut of APP_SHORTCUTS) {
      const bound = APP_COMMANDS.find((c) => c.shortcutId === shortcut.id);
      if (bound) expect(commandKeys(bound)).toBe(shortcut.keys);
    }
    expect(commandKeys(command('openTasks'))).toBeNull();
    registerShortcut({ id: 'source-mode', keys: 'Alt+S', run: sourceToggle, labelKey: 'x' });
    expect(commandKeys(command('source-mode'))).toBe('Alt+S');
    registerShortcut({ id: 'graph', keys: 'Alt+B', run: () => undefined, labelKey: 'x' });
    expect(commandKeys(command('graph'))).toBe('Alt+B');
  });

  it('every command runs and does what it says', async () => {
    expect(Object.keys(EFFECTS).sort()).toEqual(APP_COMMANDS.map((c) => c.id).sort());
    const uninstall = installShortcutListener();
    try {
      for (const c of APP_COMMANDS) {
        navigate = (await resetAppState()) as ReturnType<typeof vi.fn<Navigator>>;
        noteScreenWithTabs();
        registerShortcut({ id: 'source-mode', keys: 'Alt+S', run: sourceToggle, labelKey: 'x' });
        expect(availableCommands().map((a) => a.id)).toContain(c.id);
        c.run();
        await EFFECTS[c.id]?.();
      }
    } finally {
      uninstall();
    }
  });

  it('a rebuild already running or a failure is said in a toast', async () => {
    mock.on('POST /api/index/rebuild', {
      status: 409,
      body: { error: { code: 'CONFLICT', message: 'x' } },
    });
    command('rebuild-index').run();
    await vi.waitFor(() => expect(toasts()).toEqual([i18n.t('commands.rebuildRunning')]));
    mock.on('POST /api/index/rebuild', { status: 500, body: { error: { code: 'X' } } });
    command('rebuild-index').run();
    await vi.waitFor(() => expect(toasts()).toHaveLength(2));
    expect(toasts()[1]).toBe(i18n.t('operations.errors.generic'));
  });

  it('matches labels and keywords without diacritics, every word a prefix', () => {
    const label = (c: AppCommand) => i18n.t(c.labelKey);
    const ids = (text: string) => matchCommands(APP_COMMANDS, text, label).map((c) => c.id);
    expect(ids('mo lich')).toEqual(['openCalendar']);
    expect(ids('an/hien trai')).toEqual(['toggle-left-pane']);
    expect(ids('XÂY LẠI')).toEqual(['rebuild-index']);
    expect(ids('ban do')).toEqual(['graph']);
    expect(ids('')).toHaveLength(APP_COMMANDS.length);
    expect(ids('zzz')).toEqual([]);
  });
});
