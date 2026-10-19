import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router';
import { AppLayout } from './app-layout';
import { TodayScreen } from '../features/today/today-screen';
import { PlaceholderScreen } from '../features/placeholders/placeholder-screen';
import { NotFoundScreen } from '../features/placeholders/not-found-screen';
import { NoteScreen } from '../features/note/note-screen';
import { TagsScreen } from '../features/tags/tags-screen';
import { NotePanel } from '../features/backlinks/note-panel';

/**
 * Route handle read by the layout:
 * - `rightPanel: true` shows the right pane next to the screen (collapsible with `Alt+2`);
 * - `panel` is the component rendered inside that pane;
 * - `tabs: true` shows the note tab bar above the screen.
 */
export interface AppRouteHandle {
  rightPanel?: boolean;
  panel?: ComponentType;
  tabs?: boolean;
}

const noteHandle: AppRouteHandle = { rightPanel: true, tabs: true, panel: NotePanel };

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <TodayScreen /> },
      { path: 'tasks', element: <PlaceholderScreen kind="tasks" /> },
      { path: 'calendar', element: <PlaceholderScreen kind="calendar" /> },
      { path: 'graph', element: <PlaceholderScreen kind="graph" /> },
      // `#/note?path=<encoded vault path>` (`&new=1` right after creation).
      { path: 'note', element: <NoteScreen />, handle: noteHandle },
      { path: 'tags', element: <TagsScreen /> },
      { path: '*', element: <NotFoundScreen /> },
    ],
  },
];
