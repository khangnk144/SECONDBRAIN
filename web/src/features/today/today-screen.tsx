import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getToday } from '../../lib/api/deadlines-api';
import type { TodayView } from '../../lib/api/deadlines-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { formatLongDate } from '../../lib/format-long-date';
import { greetingPeriod } from '../../lib/greeting';
import { useLiveQuery } from '../../lib/use-live-query';
import { useNow } from '../../lib/use-now';
import { useUiPrefsStore } from '../../lib/ui-prefs-store';
import { ConnectionBanner, useConnectionBannerVisible } from '../connection/connection-banner';
import { ProjectsSection } from './projects-section';
import { QuickCaptureInline } from './quick-capture-inline';
import { SampleDataPrompt } from './sample-data-prompt';
import { keepItem, NO_KEPT_ITEMS, withKeptItems, type KeptItems } from './today-kept-items';
import { applyItemDone, withoutProject } from './today-optimistic';
import { TodayStrip } from './today-strip';
import { TodayStripSkeleton } from './today-strip-skeleton';
import { summarySentence } from './today-summary';
import { TodayTasksSection } from './today-tasks-section';
import './today-screen.css';

export const TODAY_QUERY_KEY = 'today';

/**
 * Today (route `/`, design.md screen 1): date, greeting and one summary sentence (the connection
 * banner takes its place while the server is unreachable), the 14-day strip, "Hôm nay" beside
 * "Ghi nhanh", then "Đồ án đang làm". Everything comes from `GET /today` and stays current through
 * the live query; ticks update the screen at once (optimistic), then the fresh view replaces it.
 * A task ticked here stays listed (checked, dimmed) until the user leaves Today.
 */
export function TodayScreen() {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const name = useUiPrefsStore((state) => state.prefs.name);
  const offline = useConnectionBannerVisible();
  const greetingRef = useRef<HTMLHeadingElement>(null);
  const { data, status, refresh, mutate } = useLiveQuery<TodayView>(TODAY_QUERY_KEY, getToday);
  const [kept, setKept] = useState<KeptItems>(NO_KEPT_ITEMS);
  const view = useMemo(() => (data ? withKeptItems(data, kept) : undefined), [data, kept]);
  const latest = useRef({ view, kept });
  useEffect(() => {
    latest.current = { view, kept };
  });

  const onItemDone = useCallback(
    (id: string, done: boolean) => {
      const { view: shown, kept: before } = latest.current;
      if (shown) {
        const after = keepItem(before, shown, id, done);
        latest.current = { view: shown, kept: after };
        setKept(after);
      }
      // With the rows as they were on screen, so unticking a kept row counts it open again.
      mutate((current) => applyItemDone(withKeptItems(current, before), id, done));
    },
    [mutate],
  );
  // A refused tick reloads the lists: from then on they show what the server has.
  const refreshAfterConflict = useCallback(() => {
    latest.current = { ...latest.current, kept: NO_KEPT_ITEMS };
    setKept(NO_KEPT_ITEMS);
    return refresh();
  }, [refresh]);
  const onProjectDone = useCallback(
    (path: VaultPath) => mutate((current) => withoutProject(current, path)),
    [mutate],
  );
  // After the sample card goes: the greeting takes focus, with no ring after a mouse click.
  const focusGreeting = useCallback((byPointer: boolean) => {
    const greeting = greetingRef.current;
    if (!greeting) return;
    if (byPointer) greeting.dataset.pointerFocus = 'true';
    greeting.focus();
  }, []);
  const loading = view === undefined && status !== 'error';

  return (
    <section className="today" aria-labelledby="today-greeting">
      {offline ? null : (
        <SampleDataPrompt onCreated={() => void refresh()} focusAfter={focusGreeting} />
      )}
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
