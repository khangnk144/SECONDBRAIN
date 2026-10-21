import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { getResources } from '../../lib/api/resources-api';
import { useLiveQuery } from '../../lib/use-live-query';
import { groupResources } from './resource-groups';
import { ResourceRow } from './resource-row';
import './resources.css';

const TITLE_ID = 'resources-title';

/** ↑/↓ on a file name moves to the previous/next file name (Tab still visits every control). */
function moveBetweenNames(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const target = event.target as HTMLElement;
  if (!target.classList.contains('resource-row__name')) return;
  const names = [...event.currentTarget.querySelectorAll<HTMLElement>('.resource-row__name')];
  const next = names[names.indexOf(target) + (event.key === 'ArrowDown' ? 1 : -1)];
  if (!next) return;
  event.preventDefault();
  next.focus();
}

/**
 * "Tài liệu" (`#/resources`, SPEC F15): every file in `3 Resources/` and `Attachments/`, grouped by
 * folder, with the notes that mention it; a diacritic-insensitive filter; current with the vault.
 */
export function ResourcesScreen() {
  const { t } = useTranslation();
  const filterId = useId();
  const [filter, setFilter] = useState('');
  const query = useLiveQuery('resources', getResources);
  const files = query.data?.files;
  const groups = useMemo(() => groupResources(files ?? [], filter), [files, filter]);
  const total = files?.length ?? 0;
  const shown = groups.reduce((sum, group) => sum + group.files.length, 0);

  return (
    <section className="resources-screen" aria-labelledby={TITLE_ID}>
      <h1 id={TITLE_ID} className="text-display">
        {t('resources.title')}
      </h1>
      {query.status === 'loading' && !files ? (
        <p className="resources-screen__note" role="status">
          {t('resources.loading')}
        </p>
      ) : null}
      {query.status === 'error' ? (
        <div className="resources-screen__note">
          <p role="alert">{t('resources.loadError')}</p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void query.refresh()}
          >
            {t('resources.retry')}
          </button>
        </div>
      ) : null}
      {files && total === 0 ? (
        <p className="resources-screen__note">{t('resources.empty')}</p>
      ) : null}
      {total > 0 ? (
        <>
          <div className="resources-screen__filter">
            <label htmlFor={filterId} className="visually-hidden">
              {t('resources.filterLabel')}
            </label>
            <input
              id={filterId}
              type="search"
              className="text-input"
              placeholder={t('resources.filterPlaceholder')}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <p className="resources-screen__count" role="status">
              {filter.trim() === ''
                ? t('resources.count', { count: total })
                : t('resources.filtered', { count: shown, total })}
            </p>
          </div>
          {shown === 0 ? (
            <p className="resources-screen__note">
              {t('resources.noMatch', { filter: filter.trim() })}
            </p>
          ) : null}
          <div onKeyDown={moveBetweenNames}>
            {groups.map((group) => (
              <section key={group.key} className="resource-group">
                <h2 className="resource-group__title">{group.key}</h2>
                <ul className="resource-group__list">
                  {group.files.map((entry) => (
                    <ResourceRow key={entry.file.path} entry={entry} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
