import { X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../lib/api-client';
import { restoreNoteVersion } from '../../lib/api/history-api';
import type { HistoryCommit, HistoryUnavailableReason } from '../../lib/api/history-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { showToast } from '../../lib/toast-store';
import { noteTitleFromPath } from '../../lib/vault-paths';
import { ModalFrame } from '../dialogs/modal-frame';
import { HistoryCommitList } from './history-commit-list';
import { useHistoryDialog } from './history-dialog-store';
import { HistoryVersionPanel } from './history-version-panel';
import { useNoteHistory } from './use-note-history';
import './history.css';

const TITLE_ID = 'history-dialog-title';

/** "Lịch sử cần Git…" when git is missing; a plain "not available" for the rarer reasons. */
export function unavailableMessageKey(reason: HistoryUnavailableReason | null): string {
  return reason === 'git-missing' || reason === 'not-started' || reason === null
    ? 'history.needsGit'
    : 'history.unavailable';
}

function restoreErrorKey(error: unknown): string {
  if (isApiError(error, 'CONFLICT')) return 'history.restoreConflict';
  if (isApiError(error, 'NOT_FOUND')) return 'history.restoreMissing';
  if (isApiError(error, 'UNAVAILABLE')) return 'history.unavailable';
  if (error instanceof TypeError) return 'history.offline';
  return 'history.restoreFailed';
}

export interface HistoryDialogProps {
  path: VaultPath;
  initialCommit: string | null;
  onClose: () => void;
}

/**
 * Version history of one note (SPEC F20): versions newest first, the selected one compared with
 * the note as it is now, and a revision-checked restore. The editor picks the restored text up
 * like any change made outside (its own conflict screen if it held unsaved typing).
 */
export function HistoryDialog({ path, initialCommit, onClose }: HistoryDialogProps) {
  const { t } = useTranslation();
  const { state, reload } = useNoteHistory(path, { withCurrent: true });
  const [selected, setSelected] = useState<string | null>(initialCommit);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const cache = useRef(new Map<string, string>()).current;
  const title = noteTitleFromPath(path);

  const commits = state.status === 'ready' ? state.commits : [];
  const chosen = commits.find((c) => c.commit === selected) ?? commits[0] ?? null;

  // Once the versions are there, the keyboard starts on the selected one (↑/↓ browse).
  const listFocused = useRef(false);
  useEffect(() => {
    if (listFocused.current || commits.length === 0) return;
    listFocused.current = true;
    document.querySelector<HTMLElement>('.history-list [aria-current="true"]')?.focus();
  }, [commits.length]);

  async function restore(commit: HistoryCommit) {
    if (state.status !== 'ready' || !state.current) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      await restoreNoteVersion({
        path,
        commit: commit.commit,
        expectedRevision: state.current.revision,
      });
      useHistoryDialog.getState().restored();
      showToast({ message: t('history.restored', { title }) });
      onClose();
    } catch (error) {
      setRestoreError(t(restoreErrorKey(error)));
      // The note (or its history) moved on: show the newest list and text.
      if (isApiError(error, 'CONFLICT') || isApiError(error, 'NOT_FOUND')) await reload();
    } finally {
      setRestoring(false);
    }
  }

  let body;
  if (state.status === 'loading') {
    body = (
      <p className="history-dialog__note" role="status">
        {t('history.loading')}
      </p>
    );
  } else if (state.status === 'unavailable') {
    body = <p className="history-dialog__note">{t(unavailableMessageKey(state.reason))}</p>;
  } else if (state.status === 'missing') {
    body = <p className="history-dialog__note">{t('history.noteMissing', { title })}</p>;
  } else if (state.status === 'error') {
    body = (
      <div className="history-dialog__note">
        <p role="alert">{t(state.offline ? 'history.offline' : 'history.loadFailed')}</p>
        <button type="button" className="button button--secondary" onClick={() => void reload()}>
          {t('history.retry')}
        </button>
      </div>
    );
  } else if (commits.length === 0 || !chosen) {
    body = <p className="history-dialog__note">{t('history.empty')}</p>;
  } else {
    body = (
      <div className="history-dialog__columns">
        <HistoryCommitList
          path={path}
          commits={commits}
          selected={chosen.commit}
          onSelect={(commit) => {
            setSelected(commit);
            setRestoreError(null);
          }}
        />
        <HistoryVersionPanel
          path={path}
          commit={chosen}
          commits={commits}
          current={state.current?.content ?? ''}
          cache={cache}
          restoring={restoring}
          restoreError={restoreError}
          onRestore={(commit) => void restore(commit)}
        />
      </div>
    );
  }

  return (
    <ModalFrame labelledBy={TITLE_ID} onCancel={onClose} className="history-dialog">
      <header className="history-dialog__header">
        <div>
          <h2 id={TITLE_ID}>{t('history.title')}</h2>
          <p className="text-small">{title}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t('history.close')}
          title={t('history.close')}
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" focusable="false" />
        </button>
      </header>
      {body}
    </ModalFrame>
  );
}
