/** Test helper: puts every app-wide store back to a clean state for vault `vaultId`. */
import { resetOwnWriteRevisions } from '../../features/deadline-items/own-write-revisions';
import { resetNoteSessions } from '../../features/note-session/session-registry';
import { resetHistoryDialog } from '../../features/history/open-history-dialog';
import { resetReminders } from '../../features/reminders/reminders-store';
import { resetPdfViews } from '../../features/viewer/pdf-view-memory';
import { resetSettingsStore } from '../../features/settings/settings-store';
import { setPageReload } from '../../features/settings/vault-reload';
import { resetDocumentTargetRequests } from '../../editor/attachments/document-target-store';
import { vi } from 'vitest';
import { initI18n, i18n } from '../../i18n';
import { setAppNavigator, type Navigator } from '../app-navigation';
import { useCaptureUi } from '../capture-ui-store';
import { resetDialogs } from '../dialogs/dialog-requests';
import { buildLinkCatalog } from '../link-resolution';
import { useLinkTargetsStore } from '../link-targets-store';
import { usePanesStore } from '../panes-store';
import { useRecentNotes } from '../recent-notes-store';
import { useSearchUi } from '../search-ui-store';
import { useShortcutSheetUi } from '../shortcut-sheet-store';
import { resetShortcuts } from '../shortcuts/shortcut-registry';
import { useTabsStore } from '../tabs-store';
import { resetChatStore } from '../../features/ai-chat/chat-store';
import { resetInboxTidy } from '../../features/ai-inbox/inbox-tidy-store';
import { resetTreeReveal } from '../../features/sidebar/tree-reveal';
import { resetAiTouchStore } from '../../features/graph/graph-ai-touch';
import { resetAiStatusStore } from '../ai-status-store';
import { resetToasts } from '../toast-store';
import { resetVaultFileBlobs } from '../vault-file-blob';
import { useTreeStore } from '../tree-store';
import { useVaultStore } from '../vault-store';
import { useWritingFocus } from '../writing-focus-store';
import { useConnectionStore } from '../ws/connection-store';
import { clearServerEventHandlers } from '../ws/server-event-bus';

export async function resetAppState(vaultId: string | null = 'vault-a'): Promise<Navigator> {
  initI18n('vi');
  await i18n.changeLanguage('vi');
  try {
    localStorage.clear();
  } catch {
    // Some tests replace storage with one that throws.
  }
  resetNoteSessions();
  resetOwnWriteRevisions();
  resetToasts();
  resetDialogs();
  resetShortcuts();
  resetVaultFileBlobs();
  resetDocumentTargetRequests();
  resetSettingsStore();
  resetReminders();
  resetAiStatusStore();
  resetAiTouchStore();
  resetChatStore();
  resetInboxTidy();
  resetTreeReveal();
  setPageReload(null);
  resetPdfViews();
  resetHistoryDialog();
  clearServerEventHandlers();
  useVaultStore.setState({ vaultId, ready: true, failed: false });
  useTreeStore.setState({ tree: null, status: 'idle', expanded: [] });
  useTabsStore.setState({ tabs: [], activeId: null, hydrated: true, routeActive: false });
  useLinkTargetsStore.setState({
    titles: [],
    files: [],
    catalog: buildLinkCatalog([]),
    status: 'idle',
  });
  usePanesStore.setState({
    leftCollapsed: false,
    rightCollapsed: false,
    hydrated: true,
    earlyToggles: {},
    immersive: false,
    immersiveShowLeft: false,
    immersiveShowRight: false,
  });
  useRecentNotes.setState({ paths: [] });
  useCaptureUi.setState({ isOpen: false, returnFocus: null });
  useShortcutSheetUi.setState({ isOpen: false });
  useConnectionStore.setState({ state: 'connecting', closedSince: null });
  useSearchUi.setState({ open: false, query: '' });
  useWritingFocus.setState({ focused: false });
  const navigate = vi.fn<Navigator>();
  setAppNavigator(navigate);
  return navigate;
}
