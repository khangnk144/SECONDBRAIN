import { useEffect, useState } from 'react';
import { createHashRouter, RouterProvider } from 'react-router';
import { useTranslation } from 'react-i18next';
import { appRoutes } from './routes';

/** Root component: hash router (deep links look like `/#/note/<path>`). */
export function App() {
  const [router] = useState(() => createHashRouter(appRoutes));
  const { i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  return <RouterProvider router={router} />;
}
