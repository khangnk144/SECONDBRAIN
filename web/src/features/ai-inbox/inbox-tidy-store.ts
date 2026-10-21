/**
 * Whether the Inbox tidying dialog is open, and for what: every note of `0 Inbox` ("Dọn Inbox với
 * AI") or one note ("Gợi ý chỗ để", which asks AI right away because she just asked for it).
 */
import { create } from 'zustand';
import type { VaultPath } from '../../lib/api/vault-types';

export type InboxTidyMode = { kind: 'all' } | { kind: 'one'; path: VaultPath };

interface InboxTidyState {
  mode: InboxTidyMode | null;
  /** Bumped on every open, so reopening starts fresh. */
  openCount: number;
  open: (mode: InboxTidyMode) => void;
  close: () => void;
}

export const useInboxTidy = create<InboxTidyState>((set, get) => ({
  mode: null,
  openCount: 0,
  open: (mode) => set({ mode, openCount: get().openCount + 1 }),
  close: () => set({ mode: null }),
}));

export function openInboxTidy(mode: InboxTidyMode = { kind: 'all' }): void {
  useInboxTidy.getState().open(mode);
}

export function resetInboxTidy(): void {
  useInboxTidy.setState({ mode: null, openCount: 0 });
}
