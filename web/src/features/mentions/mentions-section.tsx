import { useRef } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { MentionRef } from '../../lib/api/notes-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { noteLinkHandlers, openNoteAtLine } from '../backlinks/open-note-at-line';
import { PanelSection } from '../backlinks/panel-section';
import { HighlightedText } from '../search/highlighted-text';
import { mentionKey, useUnlinkedMentions } from './use-unlinked-mentions';
import './mentions-section.css';

export interface MentionsSectionProps {
  path: VaultPath;
  expanded: boolean;
  onToggle: () => void;
  /** Called after a mention became a link (the backlinks list can refresh at once). */
  onLinked?: () => void;
}

/** "Nhắc đến chưa liên kết": collapsed by default, fetched when opened (SPEC F5). */
export function MentionsSection({ path, expanded, onToggle, onLinked }: MentionsSectionProps) {
  const { t } = useTranslation();
  const { state, linking, link } = useUnlinkedMentions(path, expanded, onLinked);
  const listRef = useRef<HTMLUListElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const mine = state.status !== 'idle' && state.path === path ? state : null;
  const mentions = mine?.status === 'ready' ? mine.mentions : null;

  async function linkAt(mention: MentionRef, index: number) {
    await link(mention);
    // The linked mention leaves the list: keep keyboard focus on the one that took its place.
    setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('.mention-item__link');
      const next = buttons?.[Math.min(index, buttons.length - 1)];
      (next ?? toggleRef.current)?.focus();
    }, 0);
  }

  return (
    <PanelSection
      title={t('backlinks.mentions.title')}
      count={mentions?.length}
      expanded={expanded}
      onToggle={onToggle}
      toggleRef={toggleRef}
    >
      {mine === null || mine.status === 'loading' ? (
        <p className="panel-section__note">{t('backlinks.loading')}</p>
      ) : null}
      {mine?.status === 'error' ? (
        <p className="panel-section__note" role="alert">
          {t('backlinks.mentions.loadError')}
        </p>
      ) : null}
      {mentions !== null && mentions.length === 0 ? (
        <p className="panel-section__note">{t('backlinks.mentions.empty')}</p>
      ) : null}
      {mentions !== null && mentions.length > 0 ? (
        <ul ref={listRef} className="panel-list">
          {mentions.map((mention, index) => {
            const key = mentionKey(mention);
            return (
              <li key={key} className="panel-list__item mention-item">
                <button
                  type="button"
                  className="panel-link"
                  {...noteLinkHandlers((newTab) =>
                    openNoteAtLine(mention.path, mention.line, { newTab }),
                  )}
                >
                  <span className="panel-link__title">{mention.title}</span>{' '}
                  <span className="panel-link__context">
                    <HighlightedText text={mention.context} ranges={[mention.highlight]} />
                  </span>
                </button>
                <button
                  type="button"
                  className="button button--secondary mention-item__link"
                  aria-label={mentionLinkLabel(t, mentions, index)}
                  // aria-disabled keeps focus on the button while a patch runs (disabled drops it).
                  aria-disabled={linking !== null}
                  aria-busy={linking === key}
                  onClick={() => void linkAt(mention, index)}
                >
                  {t('backlinks.mentions.link')}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </PanelSection>
  );
}

/**
 * Accessible name of a "Liên kết" button; several mentions on one line are told apart by their
 * order on that line ("lần nhắc thứ 2").
 */
function mentionLinkLabel(t: TFunction, mentions: readonly MentionRef[], index: number): string {
  const mention = mentions[index]!;
  const sameLine = mentions.filter((m) => m.path === mention.path && m.line === mention.line);
  const vars = { title: mention.title, line: mention.line };
  if (sameLine.length < 2) return t('backlinks.mentions.linkLabel', vars);
  const nth = sameLine.indexOf(mention) + 1;
  return t('backlinks.mentions.linkLabelNth', { ...vars, nth });
}
