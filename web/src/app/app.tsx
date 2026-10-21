import { useEffect, useState } from 'react';
import { createHashRouter, RouterProvider } from 'react-router';
import { useTranslation } from 'react-i18next';
import { getApiToken } from '../lib/api';
import { setRouteReader } from '../lib/app-navigation';
import { appRoutes } from './routes';
import { startAppServices } from './start-app-services';

/** Root component: hash router (deep links look like `/#/note?path=<encoded path>`). */
export function App() {
  const [router] = useState(() => createHashRouter(appRoutes));
  const { i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => startAppServices(getApiToken()), []);
  useEffect(() => setRouteReader(() => router.state.location), [router]);

  return <RouterProvider router={router} />;
}
