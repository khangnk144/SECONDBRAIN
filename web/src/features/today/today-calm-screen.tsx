import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLongDate } from '../../lib/format-long-date';
import { greetingPeriod } from '../../lib/greeting';
import { useNow } from '../../lib/use-now';
import { useUiPrefsStore } from '../../lib/ui-prefs-store';
import { ConnectionBanner, useConnectionBannerVisible } from '../connection/connection-banner';
import { WeeklyReviewCard } from '../review/weekly-review-card';
import { AiTodayLine } from './ai-today-line';
import { ProjectsSection } from './projects-section';
import { QuickCaptureInline } from './quick-capture-inline';
import { SampleDataPrompt } from './sample-data-prompt';
import { TodayBrainLine } from './today-brain-line';
import { TodayStrip } from './today-strip';
import { TodayStripSkeleton } from './today-strip-skeleton';
import { summarySentence } from './today-summary';
import { TodayTasksSection } from './today-tasks-section';
import { useTodayData } from './use-today-data';
import './today-screen.css';

/**
 * Today in the calm style (route `/`, design.md screen 1): date, greeting and one summary
 * sentence (the connection banner takes its place while the server is unreachable) with the small
 * "não hôm nay" block top right (screen 6), the weekly review on Sundays (F26), the 14-day strip,
 * "Hôm nay" beside "Ghi nhanh", then "Đồ án đang làm". Everything comes from `GET /today` and
 * stays current through the live query; ticks update the screen at once (optimistic), then the
 * fresh view replaces it. A task ticked here stays listed (checked, dimmed) until the user leaves.
 */
export function TodayCalmScreen() {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const name = useUiPrefsStore((state) => state.prefs.name);
  const offline = useConnectionBannerVisible();
  const greetingRef = useRef<HTMLHeadingElement>(null);
  const { view, status, loading, refresh, onItemDone, refreshAfterConflict, onProjectDone } =
    useTodayData();
  // After the sample card goes: the greeting takes focus, with no ring after a mouse click.
  const focusGreeting = useCallback((byPointer: boolean) => {
    const greeting = greetingRef.current;
    if (!greeting) return;
    if (byPointer) greeting.dataset.pointerFocus = 'true';
    greeting.focus();
  }, []);

  return (
    <section className="today" aria-labelledby="today-greeting">
      {offline ? null : (
        <SampleDataPrompt onCreated={() => void refresh()} focusAfter={focusGreeting} />
      )}
      <div className="today__head">
        <div className="today__head-main">
          <p className="today__date">{formatLongDate(now, i18n.language, t('today.dateFormat'))}</p>
          <h1
            id="today-greeting"
            ref={greetingRef}
            className="text-display today__greeting"
            tabIndex={-1}
            onBlur={(event) => delete event.currentTarget.dataset.pointerFocus}
          >
            {t(`today.greeting.${greetingPeriod(now)}`, { name })}
          </h1>
          {offline ? (
            <div className="today__summary-slot">
              <ConnectionBanner variant="inline" />
            </div>
          ) : (
            <p className="today__summary" aria-live="polite" aria-busy={view === undefined}>
              {view ? (
                summarySentence(view.summary, t)
              ) : (
                <span className="visually-hidden">{t('today.summary.loading')}</span>
              )}
            </p>
          )}
        </div>
        {offline ? null : <TodayBrainLine activity={view?.activity} />}
      </div>
      {offline ? null : <AiTodayLine />}
      {offline ? null : <WeeklyReviewCard variant="section" />}
      {status === 'error' && view === undefined ? (
        <div className="today__error">
          <p role="alert">{t('today.loadError')}</p>
          <button type="button" className="button button--secondary" onClick={() => void refresh()}>
            {t('today.retry')}
          </button>
        </div>
      ) : null}
      {view ? (
        <TodayStrip view={view} onItemDone={onItemDone} refresh={refreshAfterConflict} />
      ) : loading ? (
        <TodayStripSkeleton />
      ) : null}
      <div className="today__pair">
        <TodayTasksSection
          tasks={view?.todayTasks}
          onItemDone={onItemDone}
          refresh={refreshAfterConflict}
        />
        <QuickCaptureInline />
      </div>
      {view ? (
        <ProjectsSection projects={view.projects} onMarkedDone={onProjectDone} refresh={refresh} />
      ) : null}
    </section>
  );
}
