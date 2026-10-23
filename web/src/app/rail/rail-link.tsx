import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useReminderCount } from '../../features/reminders/reminders-store';
import { TODAY_ROUTE } from '../../lib/app-navigation';
import type { RailItem } from './rail-items';

export const RAIL_ICON_SIZE = 20;

/** Class of a rail entry; `is-active` on the current route (NavLink also sets aria-current). */
export const railItemClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'rail-item is-active' : 'rail-item';

/** The count shown on "Nhắc nhở" (the entry's name says it in words, so it is hidden here). */
export function RailBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="rail-item__badge" aria-hidden="true">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** Full name of an entry, with the number of reminders on "Nhắc nhở". */
export function useRailItemName(item: RailItem): { name: string; count: number } {
  const { t } = useTranslation();
  const reminders = useReminderCount();
  const label = t(item.nameKey);
  const count = item.badge === 'reminders' ? reminders : 0;
  if (count === 0) return { name: label, count };
  return {
    name: t('sidebar-nav.withCount', { label, count: t('reminders.badge', { count }) }),
    count,
  };
}

/**
 * One rail entry: icon 20 px over a short label (`rail.short.*`); the full name is the accessible
 * name and the tooltip (design.md §12.2).
 */
export function RailLink({ item, onNavigate }: { item: RailItem; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { name, count } = useRailItemName(item);
  const ItemIcon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === TODAY_ROUTE}
      className={railItemClass}
      aria-label={name}
      title={name}
      onClick={onNavigate}
    >
      <span className="rail-item__icon">
        <ItemIcon size={RAIL_ICON_SIZE} aria-hidden="true" focusable="false" />
        <RailBadge count={count} />
      </span>
      <span className="rail-item__label">{t(`rail.short.${item.id}`)}</span>
    </NavLink>
  );
}
