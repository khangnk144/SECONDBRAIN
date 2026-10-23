import { GearSix } from '@phosphor-icons/react';
import { useLayoutEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useReminderCount } from '../../features/reminders/reminders-store';
import { SETTINGS_ROUTE } from '../../lib/app-navigation';
import { shortcutKeys } from '../../lib/shortcuts/use-app-shortcuts';
import { revealInRow } from '../reveal-in-row';
import { useRowScroll } from '../use-row-scroll';
import { FolderToggleButton } from './folder-toggle-button';
import { RAIL_ITEMS } from './rail-items';
import { RAIL_ICON_SIZE, RailLink, railItemClass } from './rail-link';

/** "Cài đặt" at the bottom of the rail (`Alt+,` in its tooltip). */
export function RailSettingsLink({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const name = t('sidebar-nav.settings');
  return (
    <NavLink
      to={SETTINGS_ROUTE}
      className={railItemClass}
      aria-label={name}
      aria-keyshortcuts={shortcutKeys('settings')}
      title={t('panes.withShortcut', { label: name, keys: shortcutKeys('settings') })}
      onClick={onNavigate}
    >
      <span className="rail-item__icon">
        <GearSix size={RAIL_ICON_SIZE} aria-hidden="true" focusable="false" />
      </span>
      <span className="rail-item__label">{t('rail.short.settings')}</span>
    </NavLink>
  );
}

/**
 * Bento navigation rail (F35.2, design.md §12.2): an 84 px floating tile with the logo mark, the
 * eight destinations, then "Thư mục" and "Cài đặt" at the bottom. Below 960 px it is one row on
 * top: the places scroll sideways (CSS; a vertical wheel scrolls them too) while "Thư mục" and
 * "Cài đặt" stay in view at its end (review B8); the active entry is kept in view like the calm
 * row.
 */
export function Rail({ folderExpanded, folderControls }: RailFolderProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement>(null);
  const { pathname } = useLocation();
  const reminders = useReminderCount();
  useLayoutEffect(() => {
    const row = listRef.current;
    const active = row?.querySelector<HTMLElement>('.rail-item.is-active');
    if (row && active) revealInRow(row, active);
  }, [pathname, reminders]);
  useRowScroll(listRef);

  return (
    <nav className="rail" aria-label={t('nav.label')}>
      <span className="rail__logo" aria-hidden="true">
        {t('rail.logo')}
      </span>
      <ul ref={listRef} className="rail__list">
        {RAIL_ITEMS.map((item) => (
          <li key={item.id}>
            <RailLink item={item} />
          </li>
        ))}
      </ul>
      {/* Its own list: in the row layout it never scrolls out of view with the places. */}
      <ul className="rail__list rail__list--bottom">
        <li>
          <FolderToggleButton expanded={folderExpanded} controls={folderControls} />
        </li>
        <li>
          <RailSettingsLink />
        </li>
      </ul>
    </nav>
  );
}

export interface RailFolderProps {
  /** The folder pane or drawer is on screen. */
  folderExpanded: boolean;
  /** Id of the element it shows (only while it is on screen). */
  folderControls?: string;
}
