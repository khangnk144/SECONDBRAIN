import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../lib/api-client';
import { startIndexRebuild } from '../../lib/api/settings-api';
import type { IndexProgress } from '../../lib/ws/server-event-types';
import { useServerEvent } from '../../lib/ws/use-server-event';
import { settingsSaveError } from './settings-errors';

type RebuildState =
  | { kind: 'idle' }
  | { kind: 'running'; progress: IndexProgress | null }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

/**
 * "Xây lại chỉ mục" (SPEC F18.4): the server rebuilds in the background (searches keep using the
 * old index), progress comes from `index:progress` – also for a rebuild started elsewhere.
 */
export function IndexRebuildRow() {
  const { t } = useTranslation();
  const [state, setState] = useState<RebuildState>({ kind: 'idle' });

  useServerEvent('index:progress', (event) => {
    const { phase, done, total } = event;
    setState(
      phase === 'done' ? { kind: 'done' } : { kind: 'running', progress: { phase, done, total } },
    );
  });

  const start = async () => {
    setState({ kind: 'running', progress: null });
    try {
      await startIndexRebuild();
    } catch (error) {
      // Already running (started from the palette or another window): its progress shows here.
      if (isApiError(error, 'CONFLICT')) return;
      setState({ kind: 'error', message: settingsSaveError(error) });
    }
  };

  const running = state.kind === 'running';
  const progress = running ? state.progress : null;
  const total = progress && progress.total > 0 ? progress.total : null;
  return (
    <div className="settings-field">
      <div className="settings-field__control">
        <button
          type="button"
          className="button button--secondary"
          disabled={running}
          onClick={() => void start()}
        >
          {t('settings.vault.rebuild')}
        </button>
      </div>
      <p className="settings-field__hint">{t('settings.vault.rebuildHint')}</p>
      {running ? (
        <div className="settings-progress">
          <progress
            className="settings-progress__bar"
            aria-label={t('settings.vault.rebuildProgressLabel')}
            max={total ?? undefined}
            value={total !== null && progress ? Math.min(progress.done, total) : undefined}
          />
          <p className="settings-status settings-status--block" role="status">
            {total !== null && progress
              ? t('settings.vault.rebuildProgress', { done: progress.done, count: total })
              : t('settings.vault.rebuildStarting')}
          </p>
        </div>
      ) : null}
      {state.kind === 'done' ? (
        <p className="settings-status settings-status--block" role="status">
          {t('settings.vault.rebuildDone')}
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <p className="settings-status settings-status--error" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
