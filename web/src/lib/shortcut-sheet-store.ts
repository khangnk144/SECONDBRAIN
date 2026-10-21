import { create } from 'zustand';

interface ShortcutSheetUiState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/** The shortcut sheet (`Ctrl+/`); the overlay itself lives in features/shortcut-sheet. */
export const useShortcutSheetUi = create<ShortcutSheetUiState>((set, get) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set({ isOpen: !get().isOpen }),
}));
