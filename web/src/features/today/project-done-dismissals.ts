/**
 * "Để sau" on "Đánh dấu dự án xong?" (SPEC §4.7: the offer comes once): remembered per vault and
 * project path in this browser, so the question does not come back for that project.
 */
import { useCallback, useState } from 'react';
import type { VaultPath } from '../../lib/api/vault-types';
import { vaultStorage } from '../../lib/vault-storage';
import { useVaultStore } from '../../lib/vault-store';

export const PROJECT_DONE_DISMISSED_KEY = 'today.projectDoneDismissed';

function readDismissed(): VaultPath[] {
  const stored = vaultStorage.get<unknown>(PROJECT_DONE_DISMISSED_KEY, []);
  return Array.isArray(stored) ? stored.filter((p): p is string => typeof p === 'string') : [];
}

export function useProjectDoneDismissals(): {
  isDismissed: (path: VaultPath) => boolean;
  dismiss: (path: VaultPath) => void;
} {
  // Re-read when the vault changes (the keys are per vault).
  useVaultStore((state) => state.vaultId);
  const [, setVersion] = useState(0);
  const dismissed = readDismissed();

  const dismiss = useCallback((path: VaultPath) => {
    const current = readDismissed();
    if (!current.includes(path)) vaultStorage.set(PROJECT_DONE_DISMISSED_KEY, [...current, path]);
    setVersion((v) => v + 1);
  }, []);

  return { isDismissed: (path) => dismissed.includes(path), dismiss };
}
