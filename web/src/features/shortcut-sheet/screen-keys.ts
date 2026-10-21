/**
 * Keys one screen or the editor handles itself, grouped by where they work. The brain map and the
 * PDF viewer export their lists (`GRAPH_VIEW_KEYS`, `PDF_VIEWER_KEYS`); the other components keep
 * their keys inside their key handlers, so their lists are declared here, each next to the name
 * of the component it must follow.
 */
import { GRAPH_VIEW_KEYS, type GraphViewKeyAction } from '../graph/use-graph-view-keys';
import { PDF_VIEWER_KEYS } from '../viewer/pdf-viewer-keys';
import type { LocalKeyRow } from './local-keys';

export interface ScreenKeyGroup {
  id: 'today' | 'calendar' | 'graph' | 'viewer';
  titleKey: string;
  rows: readonly LocalKeyRow[];
}

const row = (id: string, keys: readonly string[]): LocalKeyRow => ({
  id,
  keys,
  labelKey: `shortcut-sheet.screens.${id}`,
});

/**
 * Mod+Enter in the note editor, first match wins: a selected note link opens in a new tab
 * (`editor/extensions/wikilink-follow.ts`), a #tag at the caret is searched
 * (`editor/extensions/inline-decorations.ts`), otherwise the task at the caret is ticked or
 * unticked (`editor/editor-extensions.ts`, `toggleTaskAtSelection`).
 */
export const EDITOR_CONTEXT_KEYS: readonly LocalKeyRow[] = [
  { id: 'editor-tick-task', keys: ['Ctrl+Enter'], labelKey: 'shortcut-sheet.editor.tickTask' },
];

/**
 * The 14-day strip on Today (`features/today/today-strip.tsx`): roving focus from
 * `nextStripKey` in `today-strip-model.ts`; Enter or Space on a day opens its list.
 */
export const TODAY_STRIP_KEYS: readonly LocalKeyRow[] = [
  row('stripDay', ['←', '→']),
  row('stripEnds', ['Home', 'End']),
  row('stripOpen', ['Enter', 'Space']),
];

/**
 * The month grid (`features/calendar/calendar-month-grid.tsx`): arrows by day and week,
 * Home/End to the week's ends, PageUp/PageDown by month, Enter or Space opens the day.
 */
export const CALENDAR_GRID_KEYS: readonly LocalKeyRow[] = [
  row('calendarDay', ['←', '→']),
  row('calendarWeek', ['↑', '↓']),
  row('calendarWeekEnds', ['Home', 'End']),
  row('calendarMonth', ['PageUp', 'PageDown']),
  row('calendarOpen', ['Enter', 'Space']),
];

const GRAPH_LABELS: Record<GraphViewKeyAction, string> = {
  reset: 'graphReset',
  zoomIn: 'graphZoomIn',
  zoomOut: 'graphZoomOut',
  clear: 'graphClear',
};

export const SCREEN_KEY_GROUPS: readonly ScreenKeyGroup[] = [
  { id: 'today', titleKey: 'shortcut-sheet.groups.today', rows: TODAY_STRIP_KEYS },
  { id: 'calendar', titleKey: 'shortcut-sheet.groups.calendar', rows: CALENDAR_GRID_KEYS },
  {
    id: 'graph',
    titleKey: 'shortcut-sheet.groups.graph',
    rows: GRAPH_VIEW_KEYS.map(({ keys, action }) => row(GRAPH_LABELS[action], [keys])),
  },
  {
    // Only while focus is inside the viewer (`features/viewer/pdf-document-view.tsx`).
    id: 'viewer',
    titleKey: 'shortcut-sheet.groups.viewer',
    rows: PDF_VIEWER_KEYS.map(({ id, keys }) => ({
      id: `viewer-${id}`,
      keys,
      labelKey: `shortcut-sheet.viewer.${id}`,
    })),
  },
];
