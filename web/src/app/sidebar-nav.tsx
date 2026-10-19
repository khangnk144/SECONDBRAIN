import { CalendarBlank, Graph, ListChecks, Sun, Tag, type Icon } from '@phosphor-icons/react';
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';

interface NavItem {
  to: string;
  labelKey: 'nav.today' | 'nav.tasks' | 'nav.calendar' | 'nav.graph' | 'nav.tags';
  icon: Icon;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.today', icon: Sun },
  { to: '/tasks', labelKey: 'nav.tasks', icon: ListChecks },
  { to: '/calendar', labelKey: 'nav.calendar', icon: CalendarBlank },
  { to: '/graph', labelKey: 'nav.graph', icon: Graph },
  { to: '/tags', labelKey: 'nav.tags', icon: Tag },
];

export function SidebarNav() {
  const { t } = useTranslation();
  return (
    <nav className="sidebar-nav" aria-label={t('nav.label')}>
      <ul>
        {NAV_ITEMS.map(({ to, labelKey, icon: ItemIcon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                isActive ? 'sidebar-nav__item sidebar-nav__item--active' : 'sidebar-nav__item'
              }
            >
              <ItemIcon size={18} aria-hidden="true" focusable="false" />
              <span>{t(labelKey)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
