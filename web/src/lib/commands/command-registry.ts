/**
 * The palette's command registry (SPEC F8: `>` lists commands generated from one registry). A
 * command bound to a key names that shortcut (`shortcutId`) and runs the shortcut's own action,
 * so the hint and the behaviour come from the shortcut registry and are never written twice.
 */
import {
  CALENDAR_ROUTE,
  navigateTo,
  REMINDERS_ROUTE,
  RESOURCES_ROUTE,
  TAGS_ROUTE,
  TASKS_ROUTE,
  TODAY_ROUTE,
} from '../app-navigation';
import type { AppShortcutId } from '../shortcuts/use-app-shortcuts';
import { useTabsStore } from '../tabs-store';
import {
  isShortcutRegistered,
  rebuildIndex,
  registeredKeys,
  runAppShortcut,
  triggerRegisteredShortcut,
} from './command-actions';
import { openHistoryDialog } from '../../features/history/open-history-dialog';
import { isImplemented, type AppFeature } from './implemented-features';
import {
  exportBackupFromCommand,
  quitAppFromCommand,
  toggleThemeFromCommand,
} from './settings-command-actions';

export interface AppCommand {
  id: string;
  /** Full i18n key of the label (`commands.*`). */
  labelKey: string;
  /** Extra words a search may match (both languages, any diacritics; matching folds them). */
  keywords: readonly string[];
  /** Id in the shortcut registry; its keys are shown as the hint. */
  shortcutId?: string;
  feature: AppFeature;
  /** False hides the command for now (no note on screen, a single tab…). */
  isAvailable?: () => boolean;
  run: () => void;
}

/** A command that does exactly what its app-wide shortcut does. */
function shortcutCommand(
  id: AppShortcutId,
  spec: Omit<AppCommand, 'id' | 'shortcutId' | 'run'>,
): AppCommand {
  return { id, shortcutId: id, ...spec, run: () => runAppShortcut(id) };
}

const navigation = (
  id: string,
  route: string,
  feature: AppFeature,
  keywords: readonly string[],
): AppCommand => ({
  id,
  labelKey: `commands.${id}`,
  keywords,
  feature,
  run: () => navigateTo(route),
});

/** The note route is on screen with an active tab. */
function noteOnScreen(): boolean {
  const { routeActive, activeId } = useTabsStore.getState();
  return routeActive && activeId !== null;
}

const severalTabs = () => noteOnScreen() && useTabsStore.getState().tabs.length > 1;

/** The note of the active tab when a note (not a file viewer) is on screen. */
function activeNotePath(): string | null {
  if (!noteOnScreen()) return null;
  const { tabs, activeId } = useTabsStore.getState();
  const tab = tabs.find((candidate) => candidate.id === activeId);
  return tab && (tab.kind ?? 'note') === 'note' ? tab.path : null;
}

export const APP_COMMANDS: readonly AppCommand[] = [
  shortcutCommand('new-note', {
    labelKey: 'commands.newNote',
    keywords: ['tạo', 'thêm', 'new', 'create', 'note'],
    feature: 'notes',
  }),
  shortcutCommand('daily-note', {
    labelKey: 'commands.dailyNote',
    keywords: ['daily', 'nhật ký', 'hằng ngày', 'today'],
    feature: 'daily-notes',
  }),
  shortcutCommand('quick-capture', {
    labelKey: 'commands.quickCapture',
    keywords: ['inbox', 'capture', 'ghi nhanh'],
    feature: 'quick-capture',
  }),
  navigation('openToday', TODAY_ROUTE, 'today', ['dashboard', 'home', 'trang chủ', 'today']),
  navigation('openTasks', TASKS_ROUTE, 'tasks', ['tasks', 'todo', 'việc']),
  navigation('openCalendar', CALENDAR_ROUTE, 'calendar', ['calendar', 'lịch', 'deadline']),
  shortcutCommand('graph', {
    labelKey: 'commands.openGraph',
    keywords: ['graph', 'map', 'bản đồ'],
    feature: 'graph',
  }),
  navigation('openTags', TAGS_ROUTE, 'tags', ['tags', 'thẻ', '#']),
  navigation('openReminders', REMINDERS_ROUTE, 'reminders', ['reminders', 'nhắc', 'notification']),
  navigation('openResources', RESOURCES_ROUTE, 'attachments', [
    'documents',
    'pdf',
    'attachments',
    'đính kèm',
  ]),
  shortcutCommand('shortcut-sheet', {
    labelKey: 'commands.shortcutSheet',
    keywords: ['shortcuts', 'keyboard', 'phím tắt', 'help'],
    feature: 'shortcut-sheet',
  }),
  shortcutCommand('toggle-left-pane', {
    labelKey: 'commands.toggleLeftPane',
    keywords: ['sidebar', 'left', 'pane', 'ngăn trái'],
    feature: 'panes',
  }),
  shortcutCommand('toggle-right-pane', {
    labelKey: 'commands.toggleRightPane',
    keywords: ['panel', 'right', 'pane', 'ngăn phải'],
    feature: 'panes',
  }),
  {
    id: 'source-mode',
    labelKey: 'commands.sourceMode',
    keywords: ['markdown', 'source', 'nguồn'],
    shortcutId: 'source-mode',
    feature: 'source-mode',
    // The note screen registers the key only while a note is shown.
    isAvailable: () => isShortcutRegistered('source-mode'),
    run: () => void triggerRegisteredShortcut('source-mode'),
  },
  shortcutCommand('close-tab', {
    labelKey: 'commands.closeTab',
    keywords: ['close', 'tab', 'đóng', 'thẻ'],
    feature: 'tabs',
    isAvailable: noteOnScreen,
  }),
  shortcutCommand('previous-tab', {
    labelKey: 'commands.previousTab',
    keywords: ['previous', 'tab', 'thẻ'],
    feature: 'tabs',
    isAvailable: severalTabs,
  }),
  shortcutCommand('next-tab', {
    labelKey: 'commands.nextTab',
    keywords: ['next', 'tab', 'thẻ'],
    feature: 'tabs',
    isAvailable: severalTabs,
  }),
  {
    id: 'rebuild-index',
    labelKey: 'commands.rebuildIndex',
    keywords: ['index', 'rebuild', 'reindex', 'chỉ mục', 'tìm kiếm'],
    feature: 'search-index',
    run: () => void rebuildIndex(),
  },
  shortcutCommand('settings', {
    labelKey: 'commands.openSettings',
    keywords: ['settings', 'preferences', 'tùy chỉnh', 'cấu hình'],
    feature: 'settings',
  }),
  {
    id: 'note-history',
    labelKey: 'commands.noteHistory',
    keywords: ['history', 'versions', 'git', 'restore', 'lịch sử', 'phiên bản', 'khôi phục'],
    feature: 'history',
    isAvailable: () => activeNotePath() !== null,
    run: () => {
      const path = activeNotePath();
      if (path !== null) openHistoryDialog(path);
    },
  },
  {
    id: 'export-backup',
    labelKey: 'commands.exportBackup',
    keywords: ['backup', 'export', 'zip', 'sao lưu'],
    feature: 'settings',
    run: () => void exportBackupFromCommand(),
  },
  {
    id: 'toggle-theme',
    labelKey: 'commands.toggleTheme',
    keywords: ['theme', 'dark', 'light', 'chế độ', 'màu'],
    feature: 'settings',
    run: () => void toggleThemeFromCommand(),
  },
  {
    id: 'quit-app',
    labelKey: 'commands.quitApp',
    keywords: ['quit', 'exit', 'stop', 'tắt', 'dừng'],
    feature: 'settings',
    run: quitAppFromCommand,
  },
];

/** Commands the palette may list right now: their feature exists and they can run here. */
export function availableCommands(commands: readonly AppCommand[] = APP_COMMANDS): AppCommand[] {
  return commands.filter(
    (command) => isImplemented(command.feature) && (command.isAvailable?.() ?? true),
  );
}

/** The key hint of a command (from the shortcut registry), or null. */
export function commandKeys(command: AppCommand): string | null {
  return command.shortcutId ? registeredKeys(command.shortcutId) : null;
}
