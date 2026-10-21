import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VaultPath } from '../../lib/api/vault-types';
import { PanelSection } from '../backlinks/panel-section';
import { commitLabel } from './history-commit-label';
import { unavailableMessageKey } from './history-dialog';
import { useHistoryDialog } from './history-dialog-store';
import { openHistoryDialog } from './open-history-dialog';
import { useNoteHistory } from './use-note-history';

const SHOWN = 5;

/**
 * "Lịch sử" in the note's right pane: the 5 newest versions (each opens the history dialog on it)
 * and "Xem tất cả". Starts collapsed: listing asks git, which is not free on every note switch.
 */
export function HistorySection({ path }: { path: VaultPath }) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const restores = useHistoryDialog((state) => state.restores);
  const { state } = useNoteHistory(path, {
    withCurrent: false,
    enabled: expanded,
    refreshKey: restores,
  });
  const commits = state.status === 'ready' ? state.commits : [];

  return (
    <PanelSection
      title={t('history.sectionTitle')}
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
    >
      {state.status === 'loading' ? (
        <p className="panel-section__note">{t('history.loading')}</p>
      ) : null}
      {state.status === 'unavailable' ? (
        <p className="panel-section__note">{t(unavailableMessageKey(state.reason))}</p>
      ) : null}
      {state.status === 'error' || state.status === 'missing' ? (
        <p className="panel-section__note">
          {t(state.status === 'error' && state.offline ? 'history.offline' : 'history.loadFailed')}
        </p>
      ) : null}
      {state.status === 'ready' && commits.length === 0 ? (
        <p className="panel-section__note">{t('history.empty')}</p>
      ) : null}
      {commits.length > 0 ? (
        <>
          <ul className="panel-list">
            {commits.slice(0, SHOWN).map((commit) => {
              const label = commitLabel(commit, commits, i18n.language, t);
              return (
                <li key={commit.commit} className="panel-list__item">
                  <button
                    type="button"
                    className="panel-link"
                    onClick={() => openHistoryDialog(path, commit.commit)}
                  >
                    <span className="panel-link__title">{label.title}</span>
                    {label.detail ? (
                      <span className="panel-link__context">{label.detail}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="button button--secondary history-section__all"
            onClick={() => openHistoryDialog(path)}
          >
            {t('history.showAll')}
          </button>
        </>
      ) : null}
    </PanelSection>
  );
}
