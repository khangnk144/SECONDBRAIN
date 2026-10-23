/**
 * "Dọn Inbox" of the weekly review (SPEC F26.1): with in-app AI ready (enabled, consented, key,
 * budget, Inbox in scope) it opens the AI Inbox tidying dialog of F33; otherwise it opens the
 * folder tree wherever it lives (calm sidebar, bento folder pane, or the drawer) with `0 Inbox`
 * expanded, its row selected and focused, so she can drag or move its notes into folders.
 */
import { useAiStatusStore } from '../../lib/ai-status-store';
import type { AiStatus } from '../../lib/api/ai-types';
import { showFolderTree } from '../../lib/panes-store';
import { INBOX_FOLDER } from '../../lib/vault-paths';
import { aiBlocker } from '../ai-actions/ai-readiness';
import { INBOX_PROBE_PATH } from '../ai-inbox/inbox-notes';
import { openInboxTidy } from '../ai-inbox/inbox-tidy-store';
import { revealFolderInTree } from '../sidebar/tree-reveal';

/** True when "Dọn Inbox" opens the AI dialog (the button says so in its description). */
export function inboxTidyUsesAi(status: AiStatus | null = useAiStatusStore.getState().status) {
  return aiBlocker(status, INBOX_PROBE_PATH) === null;
}

export function tidyInbox(): void {
  if (inboxTidyUsesAi()) {
    openInboxTidy({ kind: 'all' });
    return;
  }
  revealFolderInTree(INBOX_FOLDER);
  showFolderTree();
}
