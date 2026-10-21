import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { getResources } from '../../lib/api/resources-api';
import { useTabsStore } from '../../lib/tabs-store';
import { useLiveQuery } from '../../lib/use-live-query';
import { samePath } from '../../lib/vault-paths';
import { noteLinkHandlers } from '../backlinks/open-note-at-line';
import { PanelSection } from '../backlinks/panel-section';

/**
 * Right pane of the viewer tab: "Ghi chú nhắc đến tài liệu này", the notes whose links resolve to
 * the file (from `GET /api/resources`), kept current by vault events.
 */
export function FileReferencesPanel() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const path = params.get('path');
  const [expanded, setExpanded] = useState(true);
  const query = useLiveQuery('resources', getResources);
  if (!path) return null;
  const file = query.data?.files.find((entry) => samePath(entry.path, path));
  const references = file?.referencedBy ?? null;

  return (
    <div className="note-panel">
      <PanelSection
        title={t('viewer.references.title')}
        count={references?.length}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
      >
        {query.status === 'loading' && !query.data ? (
          <p className="panel-section__note">{t('viewer.references.loading')}</p>
        ) : null}
        {query.status === 'error' ? (
          <p className="panel-section__note" role="alert">
            {t('viewer.references.loadError')}
          </p>
        ) : null}
        {query.data && (references === null || references.length === 0) ? (
          <p className="panel-section__note">{t('viewer.references.empty')}</p>
        ) : null}
        {references && references.length > 0 ? (
          <ul className="panel-list">
            {references.map((ref) => (
              <li key={ref.path} className="panel-list__item">
                <button
                  type="button"
                  className="panel-link"
                  title={ref.path}
                  {...noteLinkHandlers((newTab) =>
                    useTabsStore.getState().openNote(ref.path, { newTab }),
                  )}
                >
                  <span className="panel-link__title">{ref.title}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </PanelSection>
    </div>
  );
}
