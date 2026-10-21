import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { HistoryCommit } from '../../lib/api/history-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { noteTitleFromPath, samePath } from '../../lib/vault-paths';
import { commitLabel } from './history-commit-label';

export interface HistoryCommitListProps {
  path: VaultPath;
  commits: readonly HistoryCommit[];
  selected: string | null;
  onSelect: (commit: string) => void;
}

/** ↑/↓ (and Home/End) move between versions; Tab leaves the list. */
function moveSelection(event: KeyboardEvent<HTMLUListElement>): void {
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
  const index = buttons.indexOf(event.target as HTMLButtonElement);
  if (index === -1) return;
  const moves: Record<string, number> = {
    ArrowDown: Math.min(index + 1, buttons.length - 1),
    ArrowUp: Math.max(index - 1, 0),
    Home: 0,
    End: buttons.length - 1,
  };
  const next = moves[event.key];
  if (next === undefined) return;
  event.preventDefault();
  buttons[next]?.focus();
  buttons[next]?.click();
}

/** The versions of a note, newest first; the selected one is marked `aria-current`. */
export function HistoryCommitList({ path, commits, selected, onSelect }: HistoryCommitListProps) {
  const { t, i18n } = useTranslation();
  return (
    <ul className="history-list" aria-label={t('history.listLabel')} onKeyDown={moveSelection}>
      {commits.map((commit) => {
        const label = commitLabel(commit, commits, i18n.language, t);
        const renamed = !samePath(commit.pathAtCommit, path);
        const isSelected = commit.commit === selected;
        return (
          <li key={commit.commit}>
            <button
              type="button"
              className="history-list__item"
              aria-current={isSelected ? 'true' : undefined}
              tabIndex={isSelected || (selected === null && commit === commits[0]) ? 0 : -1}
              onClick={() => onSelect(commit.commit)}
            >
              <span className="history-list__title">{label.title}</span>
              {label.detail ? <span className="history-list__detail">{label.detail}</span> : null}
              {renamed ? (
                <span className="history-list__detail">
                  {t('history.oldName', { title: noteTitleFromPath(commit.pathAtCommit) })}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
