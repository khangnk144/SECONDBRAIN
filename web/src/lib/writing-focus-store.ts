import { create } from 'zustand';

interface WritingFocusState {
  /** True after a few seconds of continuous typing: both side panes fade to 60 % opacity. */
  focused: boolean;
  setFocused: (focused: boolean) => void;
}

/** Set by the editor; the layout fades the side panes and clears it on mouse move. */
export const useWritingFocus = create<WritingFocusState>((set, get) => ({
  focused: false,
  setFocused: (focused) => {
    if (get().focused !== focused) set({ focused });
  },
}));
