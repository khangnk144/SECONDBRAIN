import { useTranslation } from 'react-i18next';
import type { BacklinkRef } from '../../lib/api/notes-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { noteTitleFromPath } from '../../lib/vault-paths';
import { HighlightedText } from '../search/highlighted-text';
import { noteLinkHandlers, openNoteAtLine } from './open-note-at-line';
import { PanelSection } from './panel-section';

export interface BacklinksSectionProps {
  path: VaultPath;
  /** Null while the note is loading or could not be loaded. */
  backlinks: BacklinkRef[] | null;
  loading: boolean;
  expanded: boolean;
  onToggle: () => void;
}

/** "Liên kết đến đây": each linking note with the line holding the link, link highlighted. */
export function BacklinksSection({
  path,
  backlinks,
  loading,
  expanded,
  onToggle,
}: BacklinksSectionProps) {
  const { t } = useTranslation();

  return (
    <PanelSection
      title={t('backlinks.linked.title')}
      count={backlinks?.length}
      expanded={expanded}
      onToggle={onToggle}
    >
      {backlinks === null && loading ? (
        <p className="panel-section__note">{t('backlinks.loading')}</p>
      ) : null}
      {backlinks !== null && backlinks.length === 0 ? (
        <p className="panel-section__note">
          {t('backlinks.linked.empty', { title: noteTitleFromPath(path) })}
        </p>
      ) : null}
      {backlinks !== null && backlinks.length > 0 ? (
        <ul className="panel-list">
          {backlinks.map((ref, index) => (
            <li key={`${ref.fromPath}:${ref.line}:${index}`} className="panel-list__item">
              <button
                type="button"
                className="panel-link"
                title={t('backlinks.linked.openLabel', { title: ref.fromTitle, line: ref.line })}
                {...noteLinkHandlers((newTab) =>
                  openNoteAtLine(ref.fromPath, ref.line, { newTab }),
                )}
              >
                <span className="panel-link__title">{ref.fromTitle}</span>{' '}
                <span className="panel-link__context">
                  <HighlightedText
                    text={ref.context}
                    ranges={ref.highlight ? [ref.highlight] : []}
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </PanelSection>
  );
}
