import {
  Bell,
  CalendarBlank,
  ChatCircleText,
  FileText,
  Graph,
  ListChecks,
  Sun,
  Tag,
  type Icon,
} from '@phosphor-icons/react';
import {
  ASK_ROUTE,
  CALENDAR_ROUTE,
  GRAPH_ROUTE,
  REMINDERS_ROUTE,
  RESOURCES_ROUTE,
  TAGS_ROUTE,
  TASKS_ROUTE,
  TODAY_ROUTE,
} from '../../lib/app-navigation';

export type RailItemId =
  'today' | 'tasks' | 'calendar' | 'graph' | 'ask' | 'resources' | 'tags' | 'reminders';

export interface RailItem {
  id: RailItemId;
  to: string;
  /** Full name: accessible name and tooltip (the same words as the calm sidebar). */
  nameKey:
    | 'nav.today'
    | 'nav.tasks'
    | 'nav.calendar'
    | 'nav.graph'
    | 'nav.tags'
    | 'ai-chat.nav'
    | 'sidebar-nav.resources'
    | 'sidebar-nav.reminders';
  icon: Icon;
  /** "Nhắc nhở" shows how many reminders are listed. */
  badge?: 'reminders';
}

/** The rail in the order of design.md §12.2 / F35.2; "Thư mục" and "Cài đặt" follow at the bottom. */
export const RAIL_ITEMS: readonly RailItem[] = [
  { id: 'today', to: TODAY_ROUTE, nameKey: 'nav.today', icon: Sun },
  { id: 'tasks', to: TASKS_ROUTE, nameKey: 'nav.tasks', icon: ListChecks },
  { id: 'calendar', to: CALENDAR_ROUTE, nameKey: 'nav.calendar', icon: CalendarBlank },
  { id: 'graph', to: GRAPH_ROUTE, nameKey: 'nav.graph', icon: Graph },
  { id: 'ask', to: ASK_ROUTE, nameKey: 'ai-chat.nav', icon: ChatCircleText },
  { id: 'resources', to: RESOURCES_ROUTE, nameKey: 'sidebar-nav.resources', icon: FileText },
  { id: 'tags', to: TAGS_ROUTE, nameKey: 'nav.tags', icon: Tag },
  {
    id: 'reminders',
    to: REMINDERS_ROUTE,
    nameKey: 'sidebar-nav.reminders',
    icon: Bell,
    badge: 'reminders',
  },
];

/** Phone widths (F28.1): these three sit in the bottom tab bar, the rest under "Thêm". */
export const BOTTOM_BAR_IDS: readonly RailItemId[] = ['today', 'tasks', 'calendar'];

export function railItem(id: RailItemId): RailItem {
  const item = RAIL_ITEMS.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`unknown rail item ${id}`);
  return item;
}
