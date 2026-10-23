import type { RefObject } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TodayView } from '../../../lib/api/deadlines-types';
import { greetingPeriod } from '../../../lib/greeting';
import { ConnectionBanner } from '../../connection/connection-banner';
import { AiTodayLine } from '../ai-today-line';
import { summarySentence } from '../today-summary';

export interface BentoGreetingTileProps {
  now: Date;
  name: string;
  view: TodayView | undefined;
  offline: boolean;
  greetingRef: RefObject<HTMLHeadingElement>;
}

/**
 * "Lời chào" (6 columns): the greeting by time of day with the name in the accent and a small
 * decorative flower, the one summary sentence (the connection banner takes its place while the
 * server is unreachable) and, when AI is ready, the assistant's line in an inner box.
 */
export function BentoGreetingTile({
  now,
  name,
  view,
  offline,
  greetingRef,
}: BentoGreetingTileProps) {
  const { t } = useTranslation();
  return (
    <section className="tile today-tile today-tile--greeting" aria-labelledby="today-greeting">
      <h1
        id="today-greeting"
        ref={greetingRef}
        className="today-greeting"
        tabIndex={-1}
        onBlur={(event) => delete event.currentTarget.dataset.pointerFocus}
      >
        <Trans
          i18nKey={`today.bento.greeting.${greetingPeriod(now)}`}
          values={{ name }}
          components={{ br: <br />, name: <span className="today-greeting__name" /> }}
        />
        <span className="today-greeting__flower" aria-hidden="true" />
      </h1>
      {offline ? (
        <div className="today-greeting__summary-slot">
          <ConnectionBanner variant="inline" />
        </div>
      ) : (
        <p className="today-greeting__summary" aria-live="polite" aria-busy={view === undefined}>
          {view ? (
            summarySentence(view.summary, t)
          ) : (
            <span className="visually-hidden">{t('today.summary.loading')}</span>
          )}
        </p>
      )}
      {offline ? null : <AiTodayLine />}
    </section>
  );
}
