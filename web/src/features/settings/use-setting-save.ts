import { useCallback, useEffect, useRef, useState } from 'react';
import type { SettingsPatch, SettingsResponse } from '../../lib/api/settings-types';
import { settingsSaveError } from './settings-errors';
import { useSettingsStore } from './settings-store';

/** "Đã lưu" stays this long after a save, then goes quiet again. */
export const SAVED_NOTICE_MS = 2_000;

export type SaveState =
  { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

/**
 * One control's save: sends the partial PUT, then shows "Đã lưu" briefly or says what went
 * wrong. Every control saves on its own change; there is no global Save button.
 */
export function useSettingSave(): {
  state: SaveState;
  save: (patch: SettingsPatch) => Promise<SettingsResponse | null>;
  fail: (message: string) => void;
  clear: () => void;
} {
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const update = useCallback((next: SaveState) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!mounted.current) return;
    setState(next);
    if (next.kind === 'saved') {
      timer.current = setTimeout(() => {
        if (mounted.current) setState({ kind: 'idle' });
      }, SAVED_NOTICE_MS);
    }
  }, []);
  const save = useCallback(
    async (patch: SettingsPatch) => {
      update({ kind: 'saving' });
      try {
        const settings = await useSettingsStore.getState().save(patch);
        update({ kind: 'saved' });
        return settings;
      } catch (error) {
        update({ kind: 'error', message: settingsSaveError(error) });
        return null;
      }
    },
    [update],
  );
  const fail = useCallback((message: string) => update({ kind: 'error', message }), [update]);
  const clear = useCallback(() => update({ kind: 'idle' }), [update]);
  return { state, save, fail, clear };
}
