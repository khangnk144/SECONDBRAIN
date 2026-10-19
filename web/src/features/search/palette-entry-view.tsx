import { FileText, Plus } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { parentFolder } from '../../lib/vault-paths';
import { HighlightedText } from './highlighted-text';
import type { PaletteEntry } from './palette-entries';

/** Content of one palette row, by kind: a note (title, folder, snippet) or "Tạo '<q>'". */
export function PaletteEntryView({ entry }: { entry: PaletteEntry }) {
  const { t } = useTranslation();
  switch (entry.kind) {
    case 'note': {
      const folder = parentFolder(entry.hit.path);
      const snippet = entry.hit.snippet;
      return (
        <>
          <FileText
            className="palette-option__icon"
            size={18}
            aria-hidden="true"
            focusable="false"
          />
          <span className="palette-option__main">
            <span className="palette-option__line">
              <span className="palette-option__title">{entry.hit.title}</span>
              {folder ? <span className="palette-option__folder">{folder}</span> : null}
            </span>
            {snippet ? (
              <span className="palette-option__snippet">
                <HighlightedText text={snippet.text} ranges={snippet.highlights} />
              </span>
            ) : null}
          </span>
        </>
      );
    }
    case 'create':
      return (
        <>
          <Plus className="palette-option__icon" size={18} aria-hidden="true" focusable="false" />
          <span className="palette-option__main">
            <span className="palette-option__title">
              {t('search.create', { query: entry.title })}
            </span>
          </span>
        </>
      );
  }
}
