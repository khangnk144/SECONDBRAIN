import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Right pane (properties, backlinks, outline, AI) shown next to screens whose route handle asks
 * for it; the content is the route's `panel` component.
 */
export function RightPanel({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <aside className="right-panel" aria-label={t('panel.label')}>
      {children}
    </aside>
  );
}
