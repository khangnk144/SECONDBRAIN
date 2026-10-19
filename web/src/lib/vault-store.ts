import { create } from 'zustand';
import { getHealth } from './api/vault-api';

interface VaultState {
  /** `vault.json` id of the open vault; null while unknown or when no vault is open. */
  vaultId: string | null;
  /** True once the boot health check answered (or failed): per-vault state may be read. */
  ready: boolean;
  setVault: (vaultId: string | null) => void;
  /** Reads the vault id from `GET /api/health`; a failure leaves `vaultId` null but `ready`. */
  load: () => Promise<string | null>;
}

export const useVaultStore = create<VaultState>((set) => ({
  vaultId: null,
  ready: false,
  setVault: (vaultId) => set({ vaultId, ready: true }),
  load: async () => {
    try {
      const health = await getHealth();
      set({ vaultId: health.vaultId, ready: true });
      return health.vaultId;
    } catch {
      set({ vaultId: null, ready: true });
      return null;
    }
  },
}));
