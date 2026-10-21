import { useTranslation } from 'react-i18next';
import type { VaultPath } from '../../lib/api/vault-types';
import { baseName } from '../../lib/vault-paths';
import { FileMissingState, FileProblemState } from './file-viewer-states';
import { PdfDocumentView } from './pdf-document-view';
import { usePdfDocument } from './use-pdf-document';
import { downloadVaultFile, openWithOtherApp } from './vault-file-actions';

/** The PDF of the viewer tab, or what keeps it from showing (missing, broken, password, offline). */
export function PdfViewer({ path }: { path: VaultPath }) {
  const { t } = useTranslation();
  const { state, reload } = usePdfDocument(path);
  const name = baseName(path);

  switch (state.status) {
    case 'loading':
      return (
        <p className="file-viewer__note" role="status">
          {t('viewer.pdf.loading', { name })}
        </p>
      );
    case 'missing':
      return <FileMissingState path={path} />;
    case 'broken':
      return (
        <FileProblemState
          path={path}
          message={t(state.reason === 'password' ? 'viewer.pdf.password' : 'viewer.pdf.invalid', {
            name,
          })}
        />
      );
    case 'error':
      return (
        <FileProblemState
          path={path}
          message={state.offline ? t('viewer.files.offline') : t('viewer.pdf.loadFailed', { name })}
          onRetry={reload}
        />
      );
    case 'ready':
      return (
        <PdfDocumentView
          // A reloaded file starts fresh; page and zoom come back from the view memory.
          key={state.version}
          doc={state.doc}
          path={path}
          onDownload={() => void downloadVaultFile(path)}
          onOpenExternal={() => void openWithOtherApp(path)}
        />
      );
  }
}
