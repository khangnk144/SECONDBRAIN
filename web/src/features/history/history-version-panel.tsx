import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../lib/api-client';
import { getNoteVersion } from '../../lib/api/history-api';
import type { HistoryCommit } from '../../lib/api/history-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { commitLabel } from './history-commit-label';
import { HistoryDiffView } from './history-diff-view';

type VersionState =
  | { status: 'loading' }
  | { status: 'ready'; content: string }
  | { status: 'error'; message: string };

export interface HistoryVersionPanelProps {
  path: VaultPath;
  commit: HistoryCommit;
  commits: readonly HistoryCommit[];
  current: string;
  /** Versions already fetched in this dialog (by commit hash). */
  cache: Map<string, string>;
  restoring: boolean;
  /** Message of the last failed restore (role="alert"). */
  restoreError: string | null;
  onRestore: (commit: HistoryCommit) => void;
}

/**
 * The selected version: its label, what restoring it would change, and "Khôi phục phiên bản này"
 * with an inline confirmation (no second dialog on top of this one).
 */
export function HistoryVersionPanel(props: HistoryVersionPanelProps) {
  const { t, i18n } = useTranslation();
  const { path, commit, cache } = props;
  const [version, setVersion] = useState<VersionState>(() => {
    const cached = cache.get(commit.commit);
    return cached === undefined ? { status: 'loading' } : { status: 'ready', content: cached };
  });
  const [confirming, setConfirming] = useState(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  /** "Hủy" was pressed: the restore button takes the keyboard back. */
  const cancelled = useRef(false);

  // The pressed button is replaced: keep the keyboard on the matching one.
  useEffect(() => {
    if (confirming) confirmButton.current?.focus();
    else if (cancelled.current) restoreButton.current?.focus();
    cancelled.current = false;
  }, [confirming]);

  useEffect(() => {
    setConfirming(false);
    const cached = cache.get(commit.commit);
    if (cached !== undefined) {
      setVersion({ status: 'ready', content: cached });
      return;
    }
    let live = true;
    setVersion({ status: 'loading' });
    getNoteVersion(path, commit.commit)
      .then((answer) => {
        cache.set(commit.commit, answer.content);
        if (live) setVersion({ status: 'ready', content: answer.content });
      })
      .catch((error: unknown) => {
        if (!live) return;
        let key = 'history.versionFailed';
        if (isApiError(error, 'NOT_FOUND')) key = 'history.versionMissing';
        else if (isApiError(error, 'VALIDATION')) key = 'history.versionNotText';
        else if (error instanceof TypeError) key = 'history.offline';
        setVersion({ status: 'error', message: t(key) });
      });
    return () => {
      live = false;
    };
  }, [path, commit.commit, cache, t]);

  const label = commitLabel(commit, props.commits, i18n.language, t);
  const same = version.status === 'ready' && version.content === props.current;

  return (
    <div className="history-version">
      <h3 className="history-version__title">{label.title}</h3>
      {label.detail ? <p className="text-small">{label.detail}</p> : null}
      {version.status === 'loading' ? (
        <p className="history-dialog__note" role="status">
          {t('history.versionLoading')}
        </p>
      ) : null}
      {version.status === 'error' ? (
        <p className="history-dialog__note" role="alert">
          {version.message}
        </p>
      ) : null}
      {version.status === 'ready' ? (
        <HistoryDiffView current={props.current} version={version.content} />
      ) : null}
      {props.restoreError ? (
        <p className="history-dialog__error" role="alert">
          {props.restoreError}
        </p>
      ) : null}
      <div className="history-version__actions">
        {confirming ? (
          <>
            <p className="history-version__confirm" id="history-confirm-text">
              {t('history.confirm')}
            </p>
            <button
              ref={confirmButton}
              type="button"
              className="button button--primary"
              aria-describedby="history-confirm-text"
              disabled={props.restoring}
              onClick={() => props.onRestore(commit)}
            >
              {t('history.confirmRestore')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={props.restoring}
              onClick={() => {
                cancelled.current = true;
                setConfirming(false);
              }}
            >
              {t('history.cancel')}
            </button>
          </>
        ) : (
          <button
            ref={restoreButton}
            type="button"
            className="button button--primary"
            disabled={version.status !== 'ready' || same}
            title={same ? t('history.diff.same') : undefined}
            onClick={() => setConfirming(true)}
          >
            {t('history.restore')}
          </button>
        )}
      </div>
    </div>
  );
}
