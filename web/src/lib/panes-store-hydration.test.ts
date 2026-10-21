import { beforeEach, describe, expect, it } from 'vitest';
import { usePanesStore } from './panes-store';
import { resetAppState } from './testing/reset-app-state';
import { useVaultStore } from './vault-store';

describe('pane toggles while the app starts', () => {
  beforeEach(async () => {
    await resetAppState('vault-a');
    localStorage.setItem(
      'sb:vault-a:panes',
      JSON.stringify({ leftCollapsed: false, rightCollapsed: true }),
    );
    // Before GET /health: no vault id yet, nothing read.
    useVaultStore.setState({ vaultId: null });
    usePanesStore.setState({ hydrated: false, earlyToggles: {} });
  });

  it('a pane toggled before the saved state is read keeps the state the user chose, and it is saved', () => {
    usePanesStore.getState().toggleLeft(); // Alt+1 pressed early
    expect(usePanesStore.getState().leftCollapsed).toBe(true);
    useVaultStore.setState({ vaultId: 'vault-a' });
    usePanesStore.getState().hydrate();
    // Left: the user's toggle wins; right: the saved preference.
    expect(usePanesStore.getState()).toMatchObject({ leftCollapsed: true, rightCollapsed: true });
    expect(JSON.parse(localStorage.getItem('sb:vault-a:panes') ?? '{}')).toEqual({
      leftCollapsed: true,
      rightCollapsed: true,
    });
    // From now on toggles save as usual and a later hydration reads them back.
    usePanesStore.getState().toggleRight();
    usePanesStore.getState().hydrate();
    expect(usePanesStore.getState()).toMatchObject({ leftCollapsed: true, rightCollapsed: false });
  });

  it('without an early toggle the saved state is read as it is', () => {
    useVaultStore.setState({ vaultId: 'vault-a' });
    usePanesStore.getState().hydrate();
    expect(usePanesStore.getState()).toMatchObject({ leftCollapsed: false, rightCollapsed: true });
  });
});
