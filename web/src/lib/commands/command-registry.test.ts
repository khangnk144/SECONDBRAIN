import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistoryDialog } from '../../features/history/history-dialog-store';
import { resetHistoryDialog } from '../../features/history/open-history-dialog';
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
import { useDialogStore } from '../dialogs/dialog-requests';
import { useToastStore } from '../toast-store';
import { useUiPrefsStore } from '../ui-prefs-store';
import { emitServerEvent } from '../ws/server-event-bus';
import { matchCommands } from './command-matching';
import { APP_COMMANDS, availableCommands, commandKeys, type AppCommand } from './command-registry';
import { IMPLEMENTED_FEATURES, type AppFeature } from './implemented-features';
import { useChatStore } from '../../features/ai-chat/chat-store';
import { AI_EDITOR_ACTIONS } from '../../features/ai-actions/ai-action-kinds';
import { registerAiActionTarget } from '../../features/ai-actions/ai-action-target';
import { resetInboxTidy, useInboxTidy } from '../../features/ai-inbox/inbox-tidy-store';

let navigate: ReturnType<typeof vi.fn<Navigator>>;
let mock: FetchMock;

const command = (id: string): AppCommand => {
  const found = APP_COMMANDS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no command ${id}`);
  return found;
};
const toasts = () => useToastStore.getState().toasts.map((toast) => toast.message);
/** A note editor holding a selection (the AI selection commands need one). */
const aiStart = vi.fn();
const noteWithSelection = () =>
  registerAiActionTarget({ hasSelection: () => true, start: aiStart });

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
  'note-history': () => {
    expect(useHistoryDialog.getState().path).toBe('b/Hai.md');
    resetHistoryDialog();
  },
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
  ...Object.fromEntries(
    AI_EDITOR_ACTIONS.map((action) => [
      `ai-${action}`,
      () => expect(aiStart).toHaveBeenLastCalledWith(action),
    ]),
  ),
  'ai-tidy-inbox': () => {
    expect(useInboxTidy.getState().mode).toEqual({ kind: 'all' });
    resetInboxTidy();
  },
  'ask-ai': () => {
    expect(navigate).toHaveBeenLastCalledWith('/ask', undefined);
    expect(useChatStore.getState().focus?.threadId).toBe('ask');
  },
  openTags: () => expect(navigate).toHaveBeenLastCalledWith('/tags', undefined),
  'shortcut-sheet': () => expect(useShortcutSheetUi.getState().isOpen).toBe(true),
  'toggle-left-pane': () => expect(usePanesStore.getState().leftCollapsed).toBe(true),
  'toggle-right-pane': () => expect(usePanesStore.getState().rightCollapsed).toBe(true),
  'source-mode': () => expect(sourceToggle).toHaveBeenCalledTimes(1),
  'close-tab': () => expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(['a', 'c']),
  'previous-tab': () => expect(useTabsStore.getState().activeId).toBe('a'),
  'next-tab': () => expect(useTabsStore.getState().activeId).toBe('c'),
  openReminders: () => expect(navigate).toHaveBeenLastCalledWith('/reminders', undefined),
  openResources: () => expect(navigate).toHaveBeenLastCalledWith('/resources', undefined),
  settings: () => expect(navigate).toHaveBeenLastCalledWith('/settings', undefined),
  'export-backup': async () => {
    await vi.waitFor(() => expect(mock.callsTo('POST /api/backup/export')).toHaveLength(1));
    await vi.waitFor(() => expect(downloads).toEqual(['second-brain-sao-luu-2026-10-21-0930.zip']));
    expect(toasts()).toContain(
      i18n.t('settings.vault.exportDone', { name: 'second-brain-sao-luu-2026-10-21-0930.zip' }),
    );
  },
  'toggle-theme': async () => {
    await vi.waitFor(() => expect(mock.callsTo('PUT /api/settings')).toHaveLength(1));
    expect(mock.callsTo('PUT /api/settings')[0]?.body).toEqual({ ui: { theme: 'light' } });
    expect(useUiPrefsStore.getState().prefs.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  },
  'quit-app': async () => {
    // Asks first; nothing stops before she confirms.
    await vi.waitFor(() => expect(useDialogStore.getState().queue).toHaveLength(1));
    expect(mock.callsTo('POST /api/shutdown')).toHaveLength(0);
    const request = useDialogStore.getState().queue[0];
    if (request?.kind === 'confirm') request.resolve(true);
    await vi.waitFor(() => expect(mock.callsTo('POST /api/shutdown')).toHaveLength(1));
    await vi.waitFor(() => expect(toasts()).toContain(i18n.t('settings.app.quitDone')));
  },
  'rebuild-index': async () => {
    await vi.waitFor(() => expect(mock.callsTo('POST /api/index/rebuild')).toHaveLength(1));
    await vi.waitFor(() => expect(toasts()).toContain(i18n.t('commands.rebuildStarted')));
    emitServerEvent({ type: 'index:progress', phase: 'done', done: 3, total: 3 });
    expect(toasts()).toContain(i18n.t('commands.rebuildDone'));
  },
};

const sourceToggle = vi.fn();
let downloads: string[] = [];

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
    mock.on('PUT /api/settings', (call) => ({
      body: { ui: { ...useUiPrefsStore.getState().prefs, ...(call.body as { ui: object }).ui } },
    }));
    mock.on('POST /api/shutdown', { status: 202, body: { ok: true } });
    sourceToggle.mockReset();
    downloads = [];
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
    const realFetch = globalThis.fetch;
    // The backup is a zip, not JSON: answered here before the JSON route table.
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== '/api/backup/export') return realFetch(input, init);
      mock.calls.push({
        method: 'POST',
        url: '/api/backup/export',
        path: '/api/backup/export',
        query: new URLSearchParams(),
        body: undefined,
      });
      return new Response('PK', {
        status: 200,
        headers: {
          'content-disposition':
            'attachment; filename="second-brain-sao-luu-2026-10-21-0930.zip"; filename*=UTF-8\'\'second-brain-sao-luu-2026-10-21-0930.zip',
          'x-sb-backup-unreadable': '0',
        },
      });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('references only features this build has and has a label in both languages', () => {
    const ids = APP_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of APP_COMMANDS) {
      expect(IMPLEMENTED_FEATURES, c.id).toContain(c.feature);
      expect(i18n.exists(c.labelKey, { lng: 'vi' }), c.labelKey).toBe(true);
      expect(i18n.exists(c.labelKey, { lng: 'en' }), c.labelKey).toBe(true);
    }
    // "Hỏi AI…" ships with the AI phase.
    expect(command('ask-ai').feature).toBe('ai');
  });

  it('hides a command whose feature is not implemented, or that cannot run here', () => {
    // Every feature of APP_FEATURES ships now; a later one stays hidden the same way.
    const later: AppCommand = {
      ...command('openToday'),
      id: 'later',
      feature: 'later' as AppFeature,
    };
    expect(availableCommands([...APP_COMMANDS, later]).map((c) => c.id)).not.toContain('later');
    const visible = availableCommands().map((c) => c.id);
    for (const id of ['source-mode', 'close-tab', 'previous-tab', 'next-tab']) {
      expect(visible).not.toContain(id);
    }
    for (const action of AI_EDITOR_ACTIONS) expect(visible).not.toContain(`ai-${action}`);
    noteScreenWithTabs();
    registerShortcut({ id: 'source-mode', keys: 'Alt+S', run: sourceToggle, labelKey: 'x' });
    const dropTarget = noteWithSelection();
    expect(availableCommands()).toHaveLength(APP_COMMANDS.length);
    dropTarget();
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
        const dropTarget = noteWithSelection();
        expect(availableCommands().map((a) => a.id)).toContain(c.id);
        c.run();
        await EFFECTS[c.id]?.();
        dropTarget();
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
