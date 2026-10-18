import { MagnifyingGlass } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

/**
 * Search entry point. The command palette arrives in a later milestone, so the
 * control is announced as unavailable instead of silently doing nothing.
 */
export function SidebarSearch() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="sidebar-search"
      aria-label={t('sidebar.searchLabel')}
      aria-disabled="true"
      aria-describedby="sidebar-search-soon"
      title={t('sidebar.searchSoon')}
    >
      <MagnifyingGlass size={18} aria-hidden="true" focusable="false" />
      <span className="sidebar-search__placeholder">{t('sidebar.searchPlaceholder')}</span>
      <kbd>Ctrl+K</kbd>
      <span id="sidebar-search-soon" className="visually-hidden">
        {t('sidebar.searchSoon')}
      </span>
    </button>
  );
}
