/**
 * The settings view of this window (`GET /api/settings`) and the single way to change it: a
 * partial `PUT`. UI preferences apply at once (before the server answered, SPEC F18.1) and go
 * back if the save fails; other windows apply them from the `settings:changed` event.
 */
import { create } from 'zustand';
import { useAiStatusStore } from '../../lib/ai-status-store';
import { getSettings, putSettings } from '../../lib/api/settings-api';
import type { SettingsPatch, SettingsResponse } from '../../lib/api/settings-types';
import { applyUiPrefsLive, withUiChange } from '../../lib/ui-prefs-live';
import { useUiPrefsStore } from '../../lib/ui-prefs-store';
import type { UiPrefs } from '../../lib/ui-prefs';

export type SettingsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface SettingsState {
  settings: SettingsResponse | null;
  status: SettingsStatus;
  /** UI saves on their way: their own `settings:changed` echoes are not applied meanwhile. */
  uiSaves: number;
  load: () => Promise<void>;
  /** Saves `patch`; resolves with the new view or rejects with the server's error. */
  save: (patch: SettingsPatch) => Promise<SettingsResponse>;
  /** UI settings changed elsewhere (another window). */
  receiveUi: (ui: UiPrefs) => void;
}

let loadSeq = 0;

const sameUi = (a: UiPrefs, b: UiPrefs) =>
  a.name === b.name &&
  a.language === b.language &&
  a.theme === b.theme &&
  a.palette === b.palette &&
  a.fontSize === b.fontSize &&
  a.style === b.style;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  status: 'idle',
  uiSaves: 0,
  load: async () => {
    const seq = ++loadSeq;
    if (get().settings === null) set({ status: 'loading' });
    try {
      const settings = await getSettings();
      if (seq !== loadSeq) return;
      set({ settings, status: 'ready' });
      // Changed while this window was not listening (reconnect): follow the stored settings.
      if (!sameUi(settings.ui, useUiPrefsStore.getState().prefs)) applyUiPrefsLive(settings.ui);
    } catch {
      if (seq !== loadSeq) return;
      if (get().settings === null) set({ status: 'error' });
    }
  },
  save: async (patch) => {
    const before = useUiPrefsStore.getState().prefs;
    if (patch.ui) {
      applyUiPrefsLive(withUiChange(patch.ui));
      set({ uiSaves: get().uiSaves + 1 });
    }
    loadSeq += 1; // a load answered before this save must not overwrite it
    try {
      const settings = await putSettings(patch);
      set({ settings, status: 'ready' });
      // What AI may do now follows at once in this window (others refetch on `ai:status`).
      if (patch.ai || patch.mcp) void useAiStatusStore.getState().load();
      // The answer holds every window's latest UI change, this one's included.
      if (patch.ui) applyUiPrefsLive(settings.ui);
      return settings;
    } catch (error) {
      if (patch.ui) applyUiPrefsLive(before);
      throw error;
    } finally {
      if (patch.ui) set({ uiSaves: get().uiSaves - 1 });
    }
  },
  receiveUi: (ui) => {
    if (get().uiSaves > 0) return;
    applyUiPrefsLive(ui);
    const current = get().settings;
    if (current) set({ settings: { ...current, ui: { ...ui } } });
  },
}));

/** Test helper. */
export function resetSettingsStore(): void {
  loadSeq += 1;
  useSettingsStore.setState({ settings: null, status: 'idle', uiSaves: 0 });
}
