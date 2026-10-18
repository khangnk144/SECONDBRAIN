import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Right pane (properties, backlinks, outline, AI) shown next to screens that need it. */
export function RightPanel({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <aside className="right-panel" aria-label={t('panel.label')}>
      {children}
    </aside>
  );
}
