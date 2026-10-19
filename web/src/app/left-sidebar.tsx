import { useTranslation } from 'react-i18next';
import { SidebarFolders } from '../features/sidebar/sidebar-folders';
import { SidebarNewNoteButton } from '../features/sidebar/sidebar-new-note-button';
import { SidebarSearch } from './sidebar-search';
import { SidebarNav } from './sidebar-nav';
import '../styles/sidebar.css';

export function LeftSidebar() {
  const { t } = useTranslation();
  return (
    <aside className="sidebar" aria-label={t('sidebar.label')}>
      <SidebarSearch />
      <SidebarNav />
      <SidebarFolders />
      <SidebarNewNoteButton />
    </aside>
  );
}
