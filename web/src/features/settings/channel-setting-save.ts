/**
 * Saving one field of the backup and reminder-channel settings (F27, F31). Like
 * `useSettingSave`, but a refused value is explained with the field's own reason
 * (`<area>.saveErrors.<reason>`, e.g. "Địa chỉ phải bắt đầu bằng https://"), falling back to the
 * general Settings messages.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { i18n } from '../../i18n';
import { isApiError } from '../../lib/api-client';
import type { SettingsPatch, SettingsResponse } from '../../lib/api/settings-types';
import { settingsSaveError } from './settings-errors';
import { useSettingsStore } from './settings-store';
import { SAVED_NOTICE_MS, type SaveState } from './use-setting-save';

export type ChannelArea = 'backup-schedule' | 'notify';

/** The sentence for a failed save of a field of `area`. */
export function channelSaveError(error: unknown, area: ChannelArea): string {
  if (isApiError(error, 'VALIDATION')) {
    const key = `${area}.saveErrors.${String(error.details.reason)}`;
    if (i18n.exists(key)) return i18n.t(key);
  }
  return settingsSaveError(error);
}

export function useChannelSettingSave(area: ChannelArea): {
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
    if (next.kind === 'saved')
      timer.current = setTimeout(
        () => mounted.current && setState({ kind: 'idle' }),
        SAVED_NOTICE_MS,
      );
  }, []);
  const save = useCallback(
    async (patch: SettingsPatch) => {
      update({ kind: 'saving' });
      try {
        const settings = await useSettingsStore.getState().save(patch);
        update({ kind: 'saved' });
        return settings;
      } catch (error) {
        update({ kind: 'error', message: channelSaveError(error, area) });
        return null;
      }
    },
    [area, update],
  );
  const fail = useCallback((message: string) => update({ kind: 'error', message }), [update]);
  const clear = useCallback(() => update({ kind: 'idle' }), [update]);
  return { state, save, fail, clear };
}
