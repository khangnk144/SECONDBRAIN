import { FilePdf, FileText, Funnel, Lightning, Plus } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { VaultPath } from '../../lib/api/vault-types';
import { commandKeys } from '../../lib/commands/command-registry';
import { vaultFileKind } from '../../lib/open-vault-file';
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

/** A file row (keyword or meaning hit): icon by type, title, "tr. N" for a PDF page, folder. */
function FileHitView(props: {
  path: VaultPath;
  title: string;
  page: number | null | undefined;
  snippet: ReactNode;
}) {
  const { t } = useTranslation();
  const folder = parentFolder(props.path);
  const pdf = vaultFileKind(props.path) === 'pdf';
  const Icon = pdf ? FilePdf : FileText;
  return (
    <>
      <Icon {...iconProps} />
      <span className="palette-option__main">
        <span className="palette-option__line">
          <span className="palette-option__title">{props.title}</span>
          {pdf && typeof props.page === 'number' ? (
            <span className="palette-option__page">{t('search.page', { page: props.page })}</span>
          ) : null}
          {folder ? <span className="palette-option__folder">{folder}</span> : null}
        </span>
        {props.snippet ? <span className="palette-option__snippet">{props.snippet}</span> : null}
      </span>
    </>
  );
}

/**
 * Content of one palette row, by kind: a note or PDF (title, page, folder, snippet), "Tạo '<q>'",
 * a command (label and its key), a filter value (`tag:đồ-án` and what it means) or a hit by
 * meaning (plain snippet).
 */
export function PaletteEntryView({ entry }: { entry: PaletteEntry }) {
  const { t } = useTranslation();
  switch (entry.kind) {
    case 'note': {
      const { snippet } = entry.hit;
      return (
        <FileHitView
          path={entry.hit.path}
          title={entry.hit.title}
          page={entry.hit.page}
          snippet={
            snippet ? <HighlightedText text={snippet.text} ranges={snippet.highlights} /> : null
          }
        />
      );
    }
    case 'semantic':
      return (
        <FileHitView
          path={entry.hit.path}
          title={entry.hit.title}
          page={entry.hit.page}
          snippet={entry.hit.snippet}
        />
      );
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
