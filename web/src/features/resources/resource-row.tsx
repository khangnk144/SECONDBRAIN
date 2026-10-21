import {
  File as FileIcon,
  FileImage,
  FilePdf,
  FileText,
  Note,
  type Icon,
} from '@phosphor-icons/react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResourceKind } from '../../lib/api/resources-types';
import { openVaultFile } from '../../lib/open-vault-file';
import { useTabsStore } from '../../lib/tabs-store';
import { noteLinkHandlers } from '../backlinks/open-note-at-line';
import { formatFileDate, formatFileSize } from './format-file-facts';
import type { ResourceEntry } from './resource-groups';
import { ResourceRowMenu } from './resource-row-menu';

const KIND_ICONS: Record<ResourceKind, Icon> = {
  pdf: FilePdf,
  image: FileImage,
  document: FileText,
  note: Note,
  other: FileIcon,
};

/**
 * One file: kind icon, name (opens it: PDFs in the viewer, notes in the editor, other files are
 * downloaded), size and date, the notes that mention it, and the row menu.
 */
export function ResourceRow({ entry }: { entry: ResourceEntry }) {
  const { t, i18n } = useTranslation();
  const { file, subfolder } = entry;
  const Icon = KIND_ICONS[file.kind] ?? FileIcon;
  const facts = [
    formatFileSize(file.size, i18n.language),
    formatFileDate(file.mtime, i18n.language, t('resources.dateFormat')),
  ];
  if (subfolder) facts.push(subfolder);

  return (
    <li className="resource-row">
      <Icon className="resource-row__icon" size={18} aria-hidden="true" focusable="false" />
      <div className="resource-row__main">
        <button
          type="button"
          className="resource-row__name"
          title={file.path}
          {...noteLinkHandlers((newTab) => openVaultFile(file.path, { newTab }))}
        >
          {file.name}
        </button>
        <p className="resource-row__facts">
          <span className="visually-hidden">{t(`resources.kind.${file.kind}`)}, </span>
          {facts.join(', ')}
        </p>
        <p className="resource-row__refs">
          {file.referencedBy.length === 0 ? (
            t('resources.noReferences')
          ) : (
            <>
              {t('resources.referencedIn')}{' '}
              {file.referencedBy.map((ref, index) => (
                <Fragment key={ref.path}>
                  {index > 0 ? ', ' : null}
                  <button
                    type="button"
                    className="resource-row__ref"
                    title={ref.path}
                    {...noteLinkHandlers((newTab) =>
                      useTabsStore.getState().openNote(ref.path, { newTab }),
                    )}
                  >
                    {ref.title}
                  </button>
                </Fragment>
              ))}
            </>
          )}
        </p>
      </div>
      <ResourceRowMenu file={file} />
    </li>
  );
}
