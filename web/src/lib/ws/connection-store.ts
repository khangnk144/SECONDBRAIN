import { create } from 'zustand';

export type ConnectionState = 'connecting' | 'open' | 'closed';

interface ConnectionStore {
  state: ConnectionState;
  /** `Date.now()` when the socket last went from open/connecting to closed; null otherwise. */
  closedSince: number | null;
  setState: (state: ConnectionState, now?: number) => void;
}

/**
 * WebSocket connection state. While reconnect attempts fail the state stays `closed` (it does not
 * flicker through `connecting`), so "closed for more than 2 s" is a stable signal for the banner.
 */
export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  state: 'connecting',
  closedSince: null,
  setState: (state, now = Date.now()) => {
    const previous = get();
    if (state === 'closed') {
      set({ state, closedSince: previous.state === 'closed' ? previous.closedSince : now });
    } else if (state === 'connecting' && previous.state === 'closed') {
      // A retry while closed keeps the "closed since" clock running.
      return;
    } else {
      set({ state, closedSince: null });
    }
  },
}));
