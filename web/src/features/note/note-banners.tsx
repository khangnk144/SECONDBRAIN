import { Info, Robot, Warning, WarningCircle, X, type Icon } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { confirmDialog } from '../../lib/dialogs/dialog-requests';
import type { SessionView } from '../note-session/note-session-types';

type Tone = 'info' | 'warning' | 'error';
const ICONS: Record<Tone, Icon> = { info: Info, warning: Warning, error: WarningCircle };

function Banner({ tone, icon, children }: { tone: Tone; icon?: Icon; children: ReactNode }) {
  const BannerIcon = icon ?? ICONS[tone];
  return (
    <div className="note-banner" data-tone={tone}>
      <BannerIcon size={18} aria-hidden="true" className="note-banner__icon" />
      <div className="note-banner__content">{children}</div>
    </div>
  );
}

interface NoteBannersProps {
  view: SessionView;
  onDiscardDraft: () => void;
  onReviewKept: () => void;
}

/** Notices above the body: restored draft, save error, read-only, wiki/control/template notes. */
export function NoteBanners({ view, onDiscardDraft, onReviewKept }: NoteBannersProps) {
  const { t } = useTranslation();
  const [draftNoticeHidden, setDraftNoticeHidden] = useState(false);

  const discard = async () => {
    const confirmed = await confirmDialog({
      title: t('note.banners.discardTitle'),
      body: t('note.banners.discardBody'),
      confirmLabel: t('note.banners.discardDraft'),
      cancelLabel: t('note.banners.keepDraft'),
      danger: true,
    });
    if (confirmed) onDiscardDraft();
  };

  return (
    <div className="note-banners">
      {view.draftRestored && !draftNoticeHidden ? (
        <Banner tone="info">
          <p role="status">{t('note.banners.draftRestored')}</p>
          <button type="button" className="button button--secondary" onClick={() => void discard()}>
            {t('note.banners.discardDraft')}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t('note.banners.dismiss')}
            onClick={() => setDraftNoticeHidden(true)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </Banner>
      ) : null}
      {view.keptCount > 0 && !view.conflict ? (
        <Banner tone="info">
          <p>{t('note.banners.kept', { count: view.keptCount })}</p>
          <button type="button" className="button button--secondary" onClick={onReviewKept}>
            {t('note.banners.reviewKept')}
          </button>
        </Banner>
      ) : null}
      {view.errorKind ? (
        <Banner tone="error">
          <p>{t(`note.saveErrors.${view.errorKind}`)}</p>
        </Banner>
      ) : null}
      {view.readOnly ? (
        <Banner tone="warning">
          <p>{t('note.banners.notUtf8')}</p>
        </Banner>
      ) : null}
      {view.noteClass === 'wiki' ? (
        <Banner tone="info" icon={Robot}>
          <p>{t('note.banners.wiki')}</p>
        </Banner>
      ) : null}
      {view.noteClass === 'control' ? (
        <Banner tone="warning">
          <p>{t('note.banners.control')}</p>
        </Banner>
      ) : null}
      {view.noteClass === 'template' ? (
        <Banner tone="info">
          <p>{t('note.banners.template')}</p>
        </Banner>
      ) : null}
    </div>
  );
}
