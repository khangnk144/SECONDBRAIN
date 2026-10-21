import { useTranslation } from 'react-i18next';
import type { VaultPath } from '../../lib/api/vault-types';
import { navigateTo, TODAY_ROUTE } from '../../lib/app-navigation';
import { tabKind, useTabsStore } from '../../lib/tabs-store';
import { baseName, samePath } from '../../lib/vault-paths';
import { downloadVaultFile, openWithOtherApp } from './vault-file-actions';

/** Closes the viewer tab of `path` (the last tab closing shows Today, as always). */
export function closeFileTab(path: VaultPath): void {
  const { tabs, closeTab } = useTabsStore.getState();
  const tab = tabs.find((t) => tabKind(t) === 'file' && samePath(t.path, path));
  if (tab) closeTab(tab.id);
  else navigateTo(TODAY_ROUTE);
}

/** "Không tìm thấy tệp …": the file was renamed elsewhere, trashed or never existed. */
export function FileMissingState({ path }: { path: VaultPath }) {
  const { t } = useTranslation();
  return (
    <div className="file-viewer__state">
      <p role="alert">{t('viewer.files.missing', { name: baseName(path) })}</p>
      <div className="file-viewer__actions">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => closeFileTab(path)}
        >
          {t('viewer.closeTab')}
        </button>
      </div>
    </div>
  );
}

export interface FileProblemStateProps {
  path: VaultPath;
  message: string;
  /** "Thử lại" (server errors); otherwise the file can still be downloaded or opened elsewhere. */
  onRetry?: () => void;
}

/** A file the viewer cannot show: say why, offer what still works. */
export function FileProblemState({ path, message, onRetry }: FileProblemStateProps) {
  const { t } = useTranslation();
  return (
    <div className="file-viewer__state">
      <p role="alert">{message}</p>
      <div className="file-viewer__actions">
        {onRetry ? (
          <button type="button" className="button button--secondary" onClick={onRetry}>
            {t('viewer.retry')}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void downloadVaultFile(path)}
            >
              {t('viewer.files.download')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void openWithOtherApp(path)}
            >
              {t('viewer.files.openExternal')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
