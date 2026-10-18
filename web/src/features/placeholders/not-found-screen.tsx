import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import './placeholder-screen.css';

export function NotFoundScreen() {
  const { t } = useTranslation();
  return (
    <section className="placeholder-screen" aria-labelledby="not-found-title">
      <h1 id="not-found-title" className="text-display">
        {t('placeholder.notFound.title')}
      </h1>
      <p className="placeholder-screen__body">{t('placeholder.notFound.body')}</p>
      <p>
        <Link to="/">{t('placeholder.notFound.back')}</Link>
      </p>
    </section>
  );
}
