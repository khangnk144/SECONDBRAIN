import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router';
import { AppLayout } from './app-layout';
import { TodayScreen } from '../features/today/today-screen';
import { NotFoundScreen } from '../features/placeholders/not-found-screen';
import { NoteScreen } from '../features/note/note-screen';
import { TagsScreen } from '../features/tags/tags-screen';
import { NotePanel } from '../features/backlinks/note-panel';
import { TasksScreen } from '../features/tasks/tasks-screen';
import { CalendarScreen } from '../features/calendar/calendar-screen';
import { CalendarDayPanel } from '../features/calendar/calendar-day-panel';
import { GraphScreen } from '../features/graph/graph-screen';
import { SettingsScreen } from '../features/settings/settings-screen';
import { RemindersScreen } from '../features/reminders/reminders-screen';
import { FileViewerScreen } from '../features/viewer/file-viewer-screen';
import { FileReferencesPanel } from '../features/viewer/file-references-panel';
import { ResourcesScreen } from '../features/resources/resources-screen';

/**
 * Route handle read by the layout:
 * - `rightPanel: true` shows the right pane next to the screen (collapsible with `Alt+2`);
 * - `panel` is the component rendered inside that pane;
 * - `tabs: true` shows the note tab bar above the screen;
 * - `immersive: true` hides both side panes while the route is on screen, without touching the
 *   stored pane preferences (`Alt+1`/`Alt+2` still show them for the visit);
 * - `inlineConnectionBanner: true`: the screen shows the backend banner itself, so the layout
 *   leaves out the global one.
 */
export interface AppRouteHandle {
  rightPanel?: boolean;
  panel?: ComponentType;
  tabs?: boolean;
  immersive?: boolean;
  inlineConnectionBanner?: boolean;
}

const todayHandle: AppRouteHandle = { inlineConnectionBanner: true };
const noteHandle: AppRouteHandle = { rightPanel: true, tabs: true, panel: NotePanel };
const calendarHandle: AppRouteHandle = { rightPanel: true, panel: CalendarDayPanel };
const graphHandle: AppRouteHandle = { immersive: true };
const fileHandle: AppRouteHandle = { rightPanel: true, tabs: true, panel: FileReferencesPanel };

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <TodayScreen />, handle: todayHandle },
      { path: 'tasks', element: <TasksScreen /> },
      { path: 'calendar', element: <CalendarScreen />, handle: calendarHandle },
      { path: 'graph', element: <GraphScreen />, handle: graphHandle },
      // `#/note?path=<encoded vault path>` (`&new=1` right after creation, `&cursor=N` for the
      // caret of a template's `{{cursor}}`, `&line=N` to show a line).
      { path: 'note', element: <NoteScreen />, handle: noteHandle },
      { path: 'tags', element: <TagsScreen /> },
      { path: 'settings', element: <SettingsScreen /> },
      { path: 'reminders', element: <RemindersScreen /> },
      // `#/file?path=<encoded vault path>`: the viewer tab of a vault file (PDF).
      { path: 'file', element: <FileViewerScreen />, handle: fileHandle },
      { path: 'resources', element: <ResourcesScreen /> },
      { path: '*', element: <NotFoundScreen /> },
    ],
  },
];
