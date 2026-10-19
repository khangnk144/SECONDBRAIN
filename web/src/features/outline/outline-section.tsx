import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { VaultPath } from '../../lib/api/vault-types';
import { jumpToLine } from '../backlinks/open-note-at-line';
import { PanelSection } from '../backlinks/panel-section';
import { extractOutline } from './outline-extract';
import './outline-section.css';

export interface OutlineSectionProps {
  path: VaultPath;
  /** Text of the note as last saved; null while loading. */
  content: string | null;
  loading: boolean;
  expanded: boolean;
  onToggle: () => void;
}

/** "Mục lục": headings 1–3 of the current note; a click moves the note to that line. */
export function OutlineSection({
  path,
  content,
  loading,
  expanded,
  onToggle,
}: OutlineSectionProps) {
  const { t } = useTranslation();
  const headings = useMemo(() => (content === null ? null : extractOutline(content)), [content]);

  return (
    <PanelSection title={t('backlinks.outline.title')} expanded={expanded} onToggle={onToggle}>
      {headings === null && loading ? (
        <p className="panel-section__note">{t('backlinks.loading')}</p>
      ) : null}
      {headings !== null && headings.length === 0 ? (
        <p className="panel-section__note">{t('backlinks.outline.empty')}</p>
      ) : null}
      {headings !== null && headings.length > 0 ? (
        <ul className="panel-list outline-list">
          {headings.map((heading) => (
            <li
              key={heading.line}
              className={`panel-list__item outline-list__item outline-list__item--h${heading.level}`}
            >
              <button
                type="button"
                className="outline-link"
                onClick={() => jumpToLine(path, heading.line)}
              >
                {heading.text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </PanelSection>
  );
}
