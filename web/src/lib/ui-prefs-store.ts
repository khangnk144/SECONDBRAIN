import { create } from 'zustand';
import { DEFAULT_UI_PREFS, type UiPrefs } from './ui-prefs';

interface UiPrefsState {
  prefs: UiPrefs;
  setPrefs: (prefs: UiPrefs) => void;
}

/** UI preferences for the current window (seeded from the boot config). */
export const useUiPrefsStore = create<UiPrefsState>((set) => ({
  prefs: { ...DEFAULT_UI_PREFS },
  setPrefs: (prefs) => set({ prefs }),
}));
