import { Sparkle } from '@phosphor-icons/react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { VaultPath } from '../../lib/api/vault-types';
import { dismissAiTouches, useAiTouchStore } from './graph-ai-touch';
import type { GraphModel } from './graph-model';
import { aiTouchTitle } from './use-ai-touch-playback';

export interface GraphAiTouchPanelProps {
  model: GraphModel | null;
  /** Polite live-region text (set once per playback). */
  announcement: string;
  onOpen: (path: VaultPath) => void;
}

/**
 * The accessible path of "AI vừa chạm" in the side panel: for each kept event (newest first) the
 * source and the pages the AI updated, in its order, each a button that opens it. Not animated;
 * the live region says it once when the map plays the event.
 */
export function GraphAiTouchPanel({ model, announcement, onOpen }: GraphAiTouchPanelProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const events = useAiTouchStore((state) => state.events);
  const newestFirst = [...events].reverse();

  return (
    <>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      {newestFirst.length > 0 ? (
        <section className="graph-touch" aria-labelledby={headingId}>
          <h2 id={headingId} className="graph-touch__title">
            <Sparkle size={16} aria-hidden="true" focusable="false" />
            {t('graph.aiTouch.title')}
          </h2>
          {newestFirst.map((event) => {
            const sourceTitle = aiTouchTitle(model, event.source);
            return (
              <div key={event.id} className="graph-touch__event">
                <p className="graph-touch__source">
                  {t('graph.aiTouch.from')}{' '}
                  <button
                    type="button"
                    className="graph-touch__link"
                    title={event.source}
                    onClick={() => onOpen(event.source)}
                  >
                    {sourceTitle}
                  </button>
                </p>
                <ol
                  className="graph-touch__pages"
                  aria-label={t('graph.aiTouch.pagesLabel', {
                    count: event.outputs.length,
                    title: sourceTitle,
                  })}
                >
                  {event.outputs.map((path) => (
                    <li key={path}>
                      <button
                        type="button"
                        className="graph-neighbors__item"
                        title={path}
                        onClick={() => onOpen(path)}
                      >
                        <span className="graph-neighbors__title">{aiTouchTitle(model, path)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
          <button
            type="button"
            className="button button--secondary graph-touch__dismiss"
            onClick={(event) => {
              // The section goes away: keep the keyboard in the panel, on its search box.
              const panel = event.currentTarget.closest('.graph-panel');
              dismissAiTouches();
              panel?.querySelector<HTMLElement>('[role="combobox"]')?.focus();
            }}
          >
            {t('graph.aiTouch.dismiss')}
          </button>
        </section>
      ) : null}
    </>
  );
}
