import { FileText, Funnel, Lightning, Plus } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { commandKeys } from '../../lib/commands/command-registry';
import { parentFolder } from '../../lib/vault-paths';
import { HighlightedText } from './highlighted-text';
import type { PaletteEntry } from './palette-entries';
import { filterText } from './palette-query';

const iconProps = {
  className: 'palette-option__icon',
  size: 18,
  'aria-hidden': true,
  focusable: false,
} as const;

/**
 * Content of one palette row, by kind: a note (title, folder, snippet), "Tạo '<q>'", a command
 * (label and its key) or a filter value (`tag:đồ-án` and what it means).
 */
export function PaletteEntryView({ entry }: { entry: PaletteEntry }) {
  const { t } = useTranslation();
  switch (entry.kind) {
    case 'note': {
      const folder = parentFolder(entry.hit.path);
      const snippet = entry.hit.snippet;
      return (
        <>
          <FileText {...iconProps} />
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
          <Plus {...iconProps} />
          <span className="palette-option__main">
            <span className="palette-option__title">
              {t('search.create', { query: entry.title })}
            </span>
          </span>
        </>
      );
    case 'command': {
      const keys = commandKeys(entry.command);
      return (
        <>
          <Lightning {...iconProps} />
          <span className="palette-option__main">
            <span className="palette-option__line">
              <span className="palette-option__title">{t(entry.command.labelKey)}</span>
              {keys ? <kbd className="palette-option__keys">{keys}</kbd> : null}
            </span>
          </span>
        </>
      );
    }
    case 'filter': {
      const { key, value, detail } = entry.suggestion;
      return (
        <>
          <Funnel {...iconProps} />
          <span className="palette-option__main">
            <span className="palette-option__line">
              <span className="palette-option__title">{filterText(key, value)}</span>
              {detail ? <span className="palette-option__folder">{detail}</span> : null}
            </span>
          </span>
        </>
      );
    }
  }
}
