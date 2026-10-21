import { startJournalSync, useJournalStore } from '../features/journal/journal-store';
import { startPermissionWatch } from '../features/reminders/notification-permission';
import { startReminderNotifications } from '../features/reminders/start-reminder-notifications';
import { startRemindersSync, useRemindersStore } from '../features/reminders/reminders-store';
import { startSettingsSync } from '../features/settings/settings-sync';
import { showVaultOpenedNotice } from '../features/settings/vault-opened-notice';
import { startLanguageFollow } from '../i18n/follow-language';
import { setApiVaultId } from '../lib/api';
import { startLinkTargetsSync, useLinkTargetsStore } from '../lib/link-targets-store';
import { usePanesStore } from '../lib/panes-store';
import { startRecentNotesSync, useRecentNotes } from '../lib/recent-notes-store';
import { startTabsSync } from '../lib/tabs-sync';
import { useTabsStore } from '../lib/tabs-store';
import { startTreeSync, useTreeStore } from '../lib/tree-store';
import { startVaultBoot } from '../lib/vault-boot';
import { useVaultStore } from '../lib/vault-store';
import { emitServerEvent } from '../lib/ws/server-event-bus';
import { startServerEvents } from '../lib/ws/start-server-events';

/** Reads every per-vault browser state (panes, expanded folders, recent notes, tabs). */
export function hydrateVaultState(): void {
  usePanesStore.getState().hydrate();
  useTreeStore.getState().hydrate();
  useRecentNotes.getState().hydrate();
  useTabsStore.getState().hydrate();
}

/** Every request names the vault this window shows, once `GET /health` told us which. */
function startVaultIdHeader(): () => void {
  setApiVaultId(useVaultStore.getState().vaultId);
  return useVaultStore.subscribe((state) => setApiVaultId(state.vaultId));
}

/**
 * Boot: WS events → stores, then `GET /health` for the vault id, then per-vault state and the
 * first fetches (retried in place when the server was not up yet, see `lib/vault-boot.ts`). Returns
 * a stop function (used by tests and React StrictMode).
 */
export function startAppServices(token: string | null): () => void {
  const stops = [
    startVaultIdHeader(),
    startTreeSync(),
    startLinkTargetsSync(),
    startTabsSync(),
    startRecentNotesSync(),
    startJournalSync(),
    startSettingsSync(),
    startRemindersSync(),
    startReminderNotifications(),
    startPermissionWatch(),
    startLanguageFollow(),
  ];
  stops.push(startServerEvents(token));
  // The page was reloaded into another vault from Settings: say that it is open now.
  showVaultOpenedNotice();
  let stopped = false;
  const firstFetches = () => {
    void useTreeStore.getState().fetchTree();
    void useLinkTargetsStore.getState().fetchTargets();
    void useJournalStore.getState().fetchPending();
    void useRemindersStore.getState().load();
  };
  // Started before the server (installed app at login, cached shell offline): the first fetches
  // fail and say so, the vault check is retried until it answers, then the per-vault state is
  // read and everything is fetched again in place – no reload, nothing typed or opened is lost.
  stops.push(
    startVaultBoot({
      onFirstCheck: (known) => {
        if (stopped) return;
        // Without a vault id there is no per-vault state to read yet.
        if (known) hydrateVaultState();
        firstFetches();
      },
      onRecovered: () => {
        if (stopped) return;
        hydrateVaultState();
        emitServerEvent({ type: 'resync' });
      },
    }),
  );
  return () => {
    stopped = true;
    stops.forEach((stop) => stop());
  };
}
