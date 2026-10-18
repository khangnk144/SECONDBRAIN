import type { RouteObject } from 'react-router';
import { AppLayout } from './app-layout';
import { TodayScreen } from '../features/today/today-screen';
import { PlaceholderScreen } from '../features/placeholders/placeholder-screen';
import { NotFoundScreen } from '../features/placeholders/not-found-screen';

/** Route handle: `rightPanel: true` shows the right pane next to the screen. */
export interface AppRouteHandle {
  rightPanel?: boolean;
}

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <TodayScreen /> },
      { path: 'tasks', element: <PlaceholderScreen kind="tasks" /> },
      { path: 'calendar', element: <PlaceholderScreen kind="calendar" /> },
      { path: 'graph', element: <PlaceholderScreen kind="graph" /> },
      { path: '*', element: <NotFoundScreen /> },
    ],
  },
];
