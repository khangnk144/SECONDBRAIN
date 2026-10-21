import { CaretLeft, CaretRight, Plus } from '@phosphor-icons/react';
import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { getDailyNeighbors } from '../../lib/api/capture-daily-api';
import type { DailyNeighbors } from '../../lib/api/capture-daily-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { openDailyNote } from '../../lib/daily-flow';
import { isoAddDays } from '../../lib/local-day';
import { showOperationError } from '../../lib/operation-errors';
import { useTabsStore } from '../../lib/tabs-store';
import { useLiveQuery } from '../../lib/use-live-query';
import { dailyDateFromPath, formatDay } from './daily-note-date';
import './daily-nav.css';

type Direction = keyof DailyNeighbors;

/**
 * Above a daily note (`Daily/YYYY-MM-DD.md`, SPEC F13): its long date between "Ngày trước" and
 * "Ngày sau", which open the nearest existing daily note in that direction (gaps skipped). When
 * there is none that way, the button offers to create the adjacent day instead. Nothing is shown
 * on other notes.
 */
export function DailyNavRow({ path }: { path: VaultPath }) {
  const date = dailyDateFromPath(path);
  return date ? <DailyNav key={date} date={date} /> : null;
}

function DailyNav({ date }: { date: string }) {
  const { t, i18n } = useTranslation();
  const key = `daily-neighbors:${date}`;
  // Refetched after vault events, so a day created or deleted elsewhere changes the buttons.
  const query = useLiveQuery(key, () => getDailyNeighbors(date));
  const neighbors = query.dataKey === key ? query.data : undefined;
  return (
    <nav className="daily-nav" aria-label={t('daily.navLabel')}>
      <DailyStep direction="previous" date={date} neighbors={neighbors} />
      <p className="daily-nav__date">
        <time dateTime={date}>{formatDay(date, i18n.language, t('daily.longDateFormat'))}</time>
      </p>
      <DailyStep direction="next" date={date} neighbors={neighbors} />
    </nav>
  );
}

interface DailyStepProps {
  direction: Direction;
  date: string;
  /** Undefined until the server answered (the button still works: it asks on click). */
  neighbors: DailyNeighbors | undefined;
}

function DailyStep({ direction, date, neighbors }: DailyStepProps) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const language = i18n.language;
  // The server answers vault paths (`Daily/2026-10-18.md`), not bare dates.
  const target = neighbors?.[direction];
  const adjacent = isoAddDays(date, direction === 'previous' ? -1 : 1);
  const targetDate = target ? dailyDateFromPath(target) : null;
  const create = target === null;

  const label = create
    ? t('daily.create', { date: formatDay(adjacent, language, t('daily.shortDateFormat')) })
    : t(direction === 'previous' ? 'daily.previous' : 'daily.next');
  const fullDate = (iso: string) => formatDay(iso, language, t('daily.fullDateFormat'));
  const title = create
    ? t('daily.createDay', { date: fullDate(adjacent) })
    : targetDate
      ? t('daily.openDay', { date: fullDate(targetDate) })
      : undefined;

  async function go(event: MouseEvent<HTMLButtonElement>) {
    const newTab = event.ctrlKey || event.metaKey;
    if (busy) return;
    setBusy(true);
    try {
      let found = target;
      if (found === undefined) {
        try {
          found = (await getDailyNeighbors(date))[direction];
        } catch (error) {
          showOperationError(error);
          return;
        }
      }
      if (found) useTabsStore.getState().openNote(found, { newTab });
      // Creates the day from the Daily template and opens it with the caret at `{{cursor}}`.
      else await openDailyNote(adjacent, { newTab });
    } finally {
      setBusy(false);
    }
  }

  const Icon = create ? Plus : direction === 'previous' ? CaretLeft : CaretRight;
  const icon = <Icon size={18} aria-hidden="true" focusable="false" />;
  return (
    <button
      type="button"
      className={`button button--secondary daily-nav__step daily-nav__step--${direction}`}
      disabled={busy}
      title={title}
      onClick={(event) => void go(event)}
    >
      {direction === 'previous' || create ? icon : null}
      <span>{label}</span>
      {direction === 'next' && !create ? icon : null}
    </button>
  );
}
