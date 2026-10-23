import { useCallback, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '../../../lib/use-now';
import { useUiPrefsStore } from '../../../lib/ui-prefs-store';
import { useConnectionBannerVisible } from '../../connection/connection-banner';
import { WeeklyReviewCard } from '../../review/weekly-review-card';
import { SampleDataPrompt } from '../sample-data-prompt';
import { TodayStrip } from '../today-strip';
import { TodayStripHead } from '../today-strip-head';
import { TodayStripSkeleton } from '../today-strip-skeleton';
import { useTodayData } from '../use-today-data';
import { BentoBrainTile } from './bento-brain-tile';
import { BentoCaptureTile } from './bento-capture-tile';
import { BentoDateTile } from './bento-date-tile';
import { BentoDeadlineTile } from './bento-deadline-tile';
import { BentoGreetingTile } from './bento-greeting-tile';
import { BentoProjectsTile } from './bento-projects-tile';
import { BentoTasksTile } from './bento-tasks-tile';
import { BentoWritingTile } from './bento-writing-tile';
import '../today-screen.css';
import './today-bento.css';
import './today-bento-tiles.css';
import './today-bento-widgets.css';

/**
 * Today in the Bento style (design.md §12.3, F35.4): a 12-column grid of tiles in reading and Tab
 * order – Lời chào (6), Ngày (2), Deadline gần nhất (4), 14 ngày tới (12), the weekly review on
 * Sundays (12), Hôm nay (5, two rows), Đồ án đang làm (4), Não hôm nay (3), Ghi nhanh (4),
 * 7 ngày ghi chép (3); two columns of full-width tiles below 960 px. Same data, ticks and kept
 * rows as calm Today (use-today-data.ts); every number comes from the server.
 */
export function TodayBentoScreen() {
  const { t } = useTranslation();
  const now = useNow();
  const name = useUiPrefsStore((state) => state.prefs.name);
  const offline = useConnectionBannerVisible();
  const greetingRef = useRef<HTMLHeadingElement>(null);
  const stripHeadingId = useId();
  const { view, status, loading, refresh, onItemDone, refreshAfterConflict, onProjectDone } =
    useTodayData();
  const activity = view?.activity;
  // After the sample card goes: the greeting takes focus, with no ring after a mouse click.
  const focusGreeting = useCallback((byPointer: boolean) => {
    const greeting = greetingRef.current;
    if (!greeting) return;
    if (byPointer) greeting.dataset.pointerFocus = 'true';
    greeting.focus();
  }, []);

  return (
    <div className="today-bento">
      {offline ? null : (
        <SampleDataPrompt onCreated={() => void refresh()} focusAfter={focusGreeting} />
      )}
      <div className="today-bento__grid">
        <BentoGreetingTile
          now={now}
          name={name}
          view={view}
          offline={offline}
          greetingRef={greetingRef}
        />
        <BentoDateTile now={now} />
        <BentoDeadlineTile view={view} />
        {status === 'error' && view === undefined ? (
          <div className="tile today-tile today-tile--wide today-tile--error">
            <p role="alert">{t('today.loadError')}</p>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void refresh()}
            >
              {t('today.retry')}
            </button>
          </div>
        ) : null}
        <section className="tile today-tile today-tile--strip" aria-labelledby={stripHeadingId}>
          {view ? (
            <TodayStrip
              view={view}
              variant="bento"
              headingId={stripHeadingId}
              onItemDone={onItemDone}
              refresh={refreshAfterConflict}
            />
          ) : (
            <>
              <TodayStripHead headingId={stripHeadingId} range={null} overdue={0} />
              {loading ? <TodayStripSkeleton variant="bento" /> : null}
            </>
          )}
        </section>
        {/* Full width when R's card has something to show; an empty wrapper takes no row. */}
        <div className="today-bento__review">
          {offline ? null : <WeeklyReviewCard variant="tile" />}
        </div>
        <BentoTasksTile
          tasks={view?.todayTasks}
          doneYesterday={activity?.doneYesterday}
          onItemDone={onItemDone}
          refresh={refreshAfterConflict}
        />
        <BentoProjectsTile
          projects={view?.projects}
          onMarkedDone={onProjectDone}
          refresh={refresh}
        />
        <BentoBrainTile activity={activity} loading={view === undefined} />
        <BentoCaptureTile />
        <BentoWritingTile activity={activity} loading={view === undefined} />
      </div>
    </div>
  );
}
