import { useTranslation } from 'react-i18next';
import { useTreeStore } from '../../lib/tree-store';
import { SidebarTree } from './sidebar-tree';

const HEADING_ID = 'sidebar-folders-heading';

/** "Thư mục": the vault tree with its loading, error and empty states. */
export function SidebarFolders() {
  const { t } = useTranslation();
  const tree = useTreeStore((state) => state.tree);
  const status = useTreeStore((state) => state.status);

  return (
    <section className="sidebar-folders" aria-labelledby={HEADING_ID}>
      <h2 id={HEADING_ID} className="sidebar-folders__heading">
        {t('sidebar.foldersHeading')}
      </h2>
      {status === 'error' && !tree ? (
        <p className="sidebar-folders__empty">
          {t('sidebar-tree.loadError')}{' '}
          <button
            type="button"
            className="sidebar-folders__retry"
            onClick={() => void useTreeStore.getState().fetchTree()}
          >
            {t('sidebar-tree.retry')}
          </button>
        </p>
      ) : null}
      {status === 'idle' && !tree ? (
        <p className="sidebar-folders__empty">{t('sidebar.foldersEmpty')}</p>
      ) : null}
      <SidebarTree labelledBy={HEADING_ID} />
      {tree && tree.root.noteCount === 0 ? (
        <p className="sidebar-folders__empty">{t('sidebar-tree.emptyVault')}</p>
      ) : null}
    </section>
  );
}
