import { FilePdf, File as FileIcon } from '@phosphor-icons/react';
import { useLocation, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { vaultFileKind } from '../../lib/open-vault-file';
import { baseName } from '../../lib/vault-paths';
import { FileProblemState } from './file-viewer-states';
import { PdfViewer, type PdfPageRequest } from './pdf-viewer';
import './viewer.css';

const TITLE_ID = 'file-viewer-title';

/** `&page=` as a number; anything but digits is NaN (the viewer then opens page 1). */
export function parsePageParam(raw: string): number {
  return /^\d{1,6}$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
}

/**
 * `#/file?path=[&page=N]`: the viewer tab of a vault file (SPEC F15.3). PDFs are shown with
 * pdf.js, at page N when asked (a search hit inside the PDF; an invalid N opens page 1); any other
 * file (an old link, a hand-typed address) is never rendered here, only offered as a download or
 * to open with another app.
 */
export function FileViewerScreen() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const location = useLocation();
  const path = params.get('path');
  const rawPage = params.get('page');
  const pageRequest: PdfPageRequest | null =
    rawPage === null ? null : { page: parsePageParam(rawPage), key: location.key };

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
        <PdfViewer path={path} pageRequest={pageRequest} />
      ) : (
        <FileProblemState path={path} message={t('viewer.notViewable', { name })} />
      )}
    </section>
  );
}
