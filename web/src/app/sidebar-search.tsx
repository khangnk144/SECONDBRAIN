import { MagnifyingGlass } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useSearchUi } from '../lib/search-ui-store';

/** Search entry point: opens the search/command palette (the same as `Ctrl+K`). */
export function SidebarSearch() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="sidebar-search"
      aria-label={t('sidebar.searchLabel')}
      aria-haspopup="dialog"
      onClick={() => useSearchUi.getState().openSearch()}
    >
      <MagnifyingGlass size={18} aria-hidden="true" focusable="false" />
      <span className="sidebar-search__placeholder">{t('sidebar.searchPlaceholder')}</span>
      <kbd>Ctrl+K</kbd>
    </button>
  );
}
