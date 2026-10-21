import {
  Bell,
  CalendarBlank,
  ChatCircleText,
  FileText,
  GearSix,
  Graph,
  ListChecks,
  Sun,
  Tag,
  type Icon,
} from '@phosphor-icons/react';
import { useLayoutEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useReminderCount } from '../features/reminders/reminders-store';
import { ASK_ROUTE, REMINDERS_ROUTE, RESOURCES_ROUTE, SETTINGS_ROUTE } from '../lib/app-navigation';
import { shortcutKeys } from '../lib/shortcuts/use-app-shortcuts';
import { revealInRow } from './reveal-in-row';
import './sidebar-nav.css';

interface NavItem {
  to: string;
  labelKey:
    | 'nav.today'
    | 'nav.tasks'
    | 'nav.calendar'
    | 'nav.graph'
    | 'nav.tags'
    | 'sidebar-nav.reminders'
    | 'sidebar-nav.resources'
    | 'ai-chat.nav';
  icon: Icon;
  badge?: 'reminders';
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.today', icon: Sun },
  { to: '/tasks', labelKey: 'nav.tasks', icon: ListChecks },
  { to: '/calendar', labelKey: 'nav.calendar', icon: CalendarBlank },
  { to: REMINDERS_ROUTE, labelKey: 'sidebar-nav.reminders', icon: Bell, badge: 'reminders' },
  { to: '/graph', labelKey: 'nav.graph', icon: Graph },
  { to: ASK_ROUTE, labelKey: 'ai-chat.nav', icon: ChatCircleText },
  { to: '/tags', labelKey: 'nav.tags', icon: Tag },
  { to: RESOURCES_ROUTE, labelKey: 'sidebar-nav.resources', icon: FileText },
];

const itemClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'sidebar-nav__item sidebar-nav__item--active' : 'sidebar-nav__item';

/** The number of listed reminders next to "Nhắc nhở" (the link's name says it in words). */
function RemindersBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="sidebar-nav__badge" aria-hidden="true">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function SidebarNav() {
  const { t } = useTranslation();
  const reminders = useReminderCount();
  const listRef = useRef<HTMLUListElement>(null);
  const { pathname } = useLocation();
  // Narrow windows: the row scrolls sideways; keep the active item (and its badge) in view.
  useLayoutEffect(() => {
    const row = listRef.current;
    const active = row?.querySelector<HTMLElement>('.sidebar-nav__item--active');
    if (row && active) revealInRow(row, active);
  }, [pathname, reminders]);
  return (
    <nav className="sidebar-nav" aria-label={t('nav.label')}>
      <ul ref={listRef}>
        {NAV_ITEMS.map(({ to, labelKey, icon: ItemIcon, badge }) => {
          const label = t(labelKey);
          const counted = badge === 'reminders' && reminders > 0;
          return (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={itemClass}
                aria-label={
                  counted
                    ? t('sidebar-nav.withCount', {
                        label,
                        count: t('reminders.badge', { count: reminders }),
                      })
                    : undefined
                }
              >
                <ItemIcon size={18} aria-hidden="true" focusable="false" />
                <span className="sidebar-nav__label">{label}</span>
                {badge === 'reminders' ? <RemindersBadge count={reminders} /> : null}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** "Cài đặt", pinned at the bottom of the left pane (`Alt+,`). */
export function SidebarSettingsLink() {
  const { t } = useTranslation();
  return (
    <nav className="sidebar-nav sidebar-nav--bottom" aria-label={t('sidebar-nav.settings')}>
      <NavLink
        to={SETTINGS_ROUTE}
        className={itemClass}
        aria-keyshortcuts={shortcutKeys('settings')}
      >
        <GearSix size={18} aria-hidden="true" focusable="false" />
        <span className="sidebar-nav__label">{t('sidebar-nav.settings')}</span>
        <kbd className="sidebar-nav__keys" aria-hidden="true">
          {shortcutKeys('settings')}
        </kbd>
      </NavLink>
    </nav>
  );
}
