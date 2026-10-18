import { useTranslation } from 'react-i18next';
import './placeholder-screen.css';

export type PlaceholderKind = 'tasks' | 'calendar' | 'graph';

/** Quiet, inviting stand-in for screens that are not built yet. */
export function PlaceholderScreen({ kind }: { kind: PlaceholderKind }) {
  const { t } = useTranslation();
  return (
    <section className="placeholder-screen" aria-labelledby={`placeholder-${kind}`}>
      <h1 id={`placeholder-${kind}`} className="text-display">
        {t(`placeholder.${kind}.title`)}
      </h1>
      <p className="placeholder-screen__body">{t(`placeholder.${kind}.body`)}</p>
    </section>
  );
}
