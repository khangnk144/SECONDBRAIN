import { create } from 'zustand';
import { DEFAULT_UI_PREFS, type Style, type UiPrefs } from './ui-prefs';

interface UiPrefsState {
  prefs: UiPrefs;
  setPrefs: (prefs: UiPrefs) => void;
}

/** UI preferences for the current window (seeded from the boot config). */
export const useUiPrefsStore = create<UiPrefsState>((set) => ({
  prefs: { ...DEFAULT_UI_PREFS },
  setPrefs: (prefs) => set({ prefs }),
}));

/**
 * The layout style shown now ('bento' | 'calm'), for components whose markup differs between the
 * styles; re-renders when it changes. Pure styling differences belong in CSS under
 * `:root[data-style='bento']` instead.
 */
export function useUiStyle(): Style {
  return useUiPrefsStore((state) => state.prefs.style);
}
