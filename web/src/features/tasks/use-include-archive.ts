import { useCallback, useReducer } from 'react';
import { vaultStorage } from '../../lib/vault-storage';
import { useVaultStore } from '../../lib/vault-store';

export const INCLUDE_ARCHIVE_KEY = 'tasks.includeArchive';

/** "Bao gồm Archive", remembered per vault in this browser. */
export function useIncludeArchive(): [boolean, (value: boolean) => void] {
  useVaultStore((state) => state.vaultId); // the stored value is per vault
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const value = vaultStorage.get<unknown>(INCLUDE_ARCHIVE_KEY, false) === true;
  const set = useCallback((next: boolean) => {
    vaultStorage.set(INCLUDE_ARCHIVE_KEY, next);
    rerender();
  }, []);
  return [value, set];
}
