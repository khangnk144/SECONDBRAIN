import { useTranslation } from 'react-i18next';
import { SidebarSearch } from './sidebar-search';
import { SidebarNav } from './sidebar-nav';
import { SidebarFolders } from './sidebar-folders';
import '../styles/sidebar.css';

export function LeftSidebar() {
  const { t } = useTranslation();
  return (
    <aside className="sidebar" aria-label={t('sidebar.label')}>
      <SidebarSearch />
      <SidebarNav />
      <SidebarFolders />
    </aside>
  );
}
