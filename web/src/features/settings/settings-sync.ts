/**
 * Keeps this window in line with the others: UI settings changed anywhere apply here at once
 * (`settings:changed`), the stored settings are re-read after a reconnect, and a vault switch –
 * announced by the event, or found out when the server refuses this window's stale vault id –
 * reloads the page into the new vault.
 */
import { setVaultSwitchedHandler } from '../../lib/api';
import { subscribeServerEvent } from '../../lib/ws/server-event-bus';
import { useSettingsStore } from './settings-store';
import { reloadIntoOpenVault } from './vault-reload';

export function startSettingsSync(): () => void {
  setVaultSwitchedHandler(() => void reloadIntoOpenVault());
  const stops = [
    subscribeServerEvent('settings:changed', (event) =>
      useSettingsStore.getState().receiveUi(event.ui),
    ),
    subscribeServerEvent('vault:switched', () => void reloadIntoOpenVault()),
    subscribeServerEvent('resync', () => void useSettingsStore.getState().load()),
  ];
  return () => {
    stops.forEach((stop) => stop());
    setVaultSwitchedHandler(null);
  };
}
