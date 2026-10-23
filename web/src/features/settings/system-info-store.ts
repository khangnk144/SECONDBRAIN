/**
 * `GET /api/system` for Settings → Ứng dụng (tray row and install row read the same answer).
 * Calls that overlap share one request; a failed load keeps what was known.
 */
import { create } from 'zustand';
import { getSystemInfo } from '../../lib/api/system-api';
import type { SystemInfo } from '../../lib/api/system-types';

interface SystemInfoState {
  info: SystemInfo | null;
  load: () => Promise<void>;
}

let inFlight: Promise<void> | null = null;

export const useSystemInfoStore = create<SystemInfoState>((set) => ({
  info: null,
  load: () => {
    inFlight ??= getSystemInfo()
      .then((info) => set({ info }))
      .catch(() => undefined)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  },
}));

/** Test helper. */
export function resetSystemInfoStore(): void {
  inFlight = null;
  useSystemInfoStore.setState({ info: null });
}
