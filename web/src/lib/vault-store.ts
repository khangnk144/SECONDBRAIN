import { create } from 'zustand';
import { getHealth } from './api/vault-api';

interface VaultState {
  /** `vault.json` id of the open vault; null while unknown or when no vault is open. */
  vaultId: string | null;
  /** True once the boot health check answered (or failed): per-vault state may be read. */
  ready: boolean;
  /**
   * The last health check got no answer (the server was not running yet): the open vault is
   * still unknown, so nothing per vault can be read and no note can open until a retry works.
   */
  failed: boolean;
  setVault: (vaultId: string | null) => void;
  /** Reads the vault id from `GET /api/health`; a failure leaves `vaultId` null but `ready`. */
  load: () => Promise<string | null>;
}

export const useVaultStore = create<VaultState>((set) => ({
  vaultId: null,
  ready: false,
  failed: false,
  setVault: (vaultId) => set({ vaultId, ready: true, failed: false }),
  load: async () => {
    try {
      const health = await getHealth();
      set({ vaultId: health.vaultId, ready: true, failed: false });
      return health.vaultId;
    } catch {
      set({ vaultId: null, ready: true, failed: true });
      return null;
    }
  },
}));
