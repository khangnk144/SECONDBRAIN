import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiChatSource } from '../../lib/api/ai-types';
import { answerLinkHandlers, answerLinkHref, openAnswerTarget } from './answer-links';

/** One entry per note or PDF page, in the order the server ranked them. */
function distinctSources(sources: readonly AiChatSource[]): AiChatSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.path}\u0000${source.page ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** "Nguồn (n)": the notes and PDF pages the answer was written from (collapsed at first). */
export function AnswerSources({ sources }: { sources: readonly AiChatSource[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const shown = distinctSources(sources);
  if (shown.length === 0) return null;
  const Caret = open ? CaretDown : CaretRight;
  return (
    <div className="ai-sources">
      <button
        type="button"
        className="ai-sources__toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <Caret size={16} aria-hidden="true" focusable="false" />
        {t('ai-chat.sources.toggle', { count: shown.length })}
      </button>
      <ul id={listId} className="ai-sources__list" hidden={!open}>
        {open
          ? shown.map((source) => (
              <li key={`${source.path}:${source.page ?? ''}`}>
                <a
                  className="ai-answer__link"
                  href={answerLinkHref(source.path)}
                  {...answerLinkHandlers((newTab) =>
                    openAnswerTarget(source.path, source.page, newTab),
                  )}
                >
                  {source.title}
                </a>
                {source.page !== null ? (
                  <span className="ai-sources__page">
                    {', '}
                    {t('ai-chat.sources.page', { page: source.page })}
                  </span>
                ) : null}
              </li>
            ))
          : null}
      </ul>
    </div>
  );
}
