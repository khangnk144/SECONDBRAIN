import { create } from 'zustand';

interface SearchUiState {
  open: boolean;
  query: string;
  /** Opens the search/command palette, optionally pre-filled (e.g. `tag:đồ-án`). */
  openSearch: (query?: string) => void;
  setQuery: (query: string) => void;
  close: () => void;
}

/** State of the search palette (`Ctrl+K`, sidebar search box, tag pills). */
export const useSearchUi = create<SearchUiState>((set) => ({
  open: false,
  query: '',
  openSearch: (query) => set((state) => ({ open: true, query: query ?? state.query })),
  setQuery: (query) => set({ query }),
  close: () => set({ open: false }),
}));
