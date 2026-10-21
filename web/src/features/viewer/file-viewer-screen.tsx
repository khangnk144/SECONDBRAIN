import { FilePdf, File as FileIcon } from '@phosphor-icons/react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { vaultFileKind } from '../../lib/open-vault-file';
import { baseName } from '../../lib/vault-paths';
import { FileProblemState } from './file-viewer-states';
import { PdfViewer } from './pdf-viewer';
import './viewer.css';

const TITLE_ID = 'file-viewer-title';

/**
 * `#/file?path=`: the viewer tab of a vault file (SPEC F15.3). PDFs are shown with pdf.js; any
 * other file (an old link, a hand-typed address) is never rendered here, only offered as a
 * download or to open with another app.
 */
export function FileViewerScreen() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const path = params.get('path');

  if (!path) {
    return (
      <section className="file-viewer" aria-labelledby={TITLE_ID}>
        <h1 id={TITLE_ID} className="file-viewer__title">
          {t('viewer.noFile')}
        </h1>
      </section>
    );
  }

  const name = baseName(path);
  const isPdf = vaultFileKind(path) === 'pdf';
  const Icon = isPdf ? FilePdf : FileIcon;
  return (
    <section className="file-viewer" aria-labelledby={TITLE_ID}>
      <header className="file-viewer__header">
        <Icon size={18} aria-hidden="true" focusable="false" />
        <h1 id={TITLE_ID} className="file-viewer__title" title={path}>
          {name}
        </h1>
      </header>
      {isPdf ? (
        <PdfViewer path={path} />
      ) : (
        <FileProblemState path={path} message={t('viewer.notViewable', { name })} />
      )}
    </section>
  );
}
