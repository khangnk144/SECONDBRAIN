import { useTranslation } from 'react-i18next';

/** Vault folders (filled from the index in a later milestone). */
export function SidebarFolders() {
  const { t } = useTranslation();
  return (
    <section className="sidebar-folders" aria-labelledby="sidebar-folders-heading">
      <h2 id="sidebar-folders-heading" className="sidebar-folders__heading">
        {t('sidebar.foldersHeading')}
      </h2>
      <p className="sidebar-folders__empty">{t('sidebar.foldersEmpty')}</p>
    </section>
  );
}
