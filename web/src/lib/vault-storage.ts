import { useVaultStore } from './vault-store';

/**
 * Browser-side state keyed by vault id (SPEC §4.13): `sb:<vaultId>:<key>` in localStorage, JSON
 * encoded. Storage can be missing or throw (private mode, blocked site data, quota): every access
 * is wrapped so the app keeps working with defaults. Without a vault id nothing is read or written,
 * so state never leaks between vaults.
 */
export interface VaultStorage {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

export function createVaultStorage(
  getVaultId: () => string | null,
  getStorage: () => Storage | null = () => window.localStorage,
): VaultStorage {
  function storage(): Storage | null {
    try {
      return getStorage();
    } catch {
      return null;
    }
  }

  function fullKey(key: string): string | null {
    const vaultId = getVaultId();
    return vaultId ? `sb:${vaultId}:${key}` : null;
  }

  return {
    get<T>(key: string, fallback: T): T {
      const name = fullKey(key);
      if (name === null) return fallback;
      try {
        const raw = storage()?.getItem(name) ?? null;
        return raw === null ? fallback : (JSON.parse(raw) as T);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      const name = fullKey(key);
      if (name === null) return;
      try {
        storage()?.setItem(name, JSON.stringify(value));
      } catch {
        // Quota or blocked storage: the state simply is not remembered.
      }
    },
    remove(key) {
      const name = fullKey(key);
      if (name === null) return;
      try {
        storage()?.removeItem(name);
      } catch {
        // Nothing to clean up when storage is unavailable.
      }
    },
  };
}

/** Storage for the vault currently open in this window. */
export const vaultStorage: VaultStorage = createVaultStorage(
  () => useVaultStore.getState().vaultId,
);
