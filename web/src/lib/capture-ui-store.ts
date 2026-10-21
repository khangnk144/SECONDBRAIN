import { create } from 'zustand';

interface CaptureUiState {
  isOpen: boolean;
  /** Element that had focus when the overlay opened (focus goes back there, F12.1). */
  returnFocus: HTMLElement | null;
  /** Opens the quick-capture overlay (`Alt+Q`), remembering where focus was. */
  open: () => void;
  /** Closes it; `restoreFocus` (default true) puts focus back where it was. */
  close: (options?: { restoreFocus?: boolean }) => void;
}

function currentFocus(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

/** State of the quick-capture overlay; the overlay itself lives in features/capture. */
export const useCaptureUi = create<CaptureUiState>((set, get) => ({
  isOpen: false,
  returnFocus: null,
  open: () => {
    // Already open: keep the focus remembered the first time, not the overlay's own input.
    if (get().isOpen) return;
    set({ isOpen: true, returnFocus: currentFocus() });
  },
  close: (options = {}) => {
    const { isOpen, returnFocus } = get();
    if (!isOpen) return;
    set({ isOpen: false, returnFocus: null });
    if (options.restoreFocus !== false && returnFocus?.isConnected) returnFocus.focus();
  },
}));
