import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TodayView } from '../../lib/api/deadlines-types';
import { claimStripIntro } from './strip-intro';
import { TodayStripCell } from './today-strip-cell';
import { anchorLeft, useOutsidePointerDown, type Anchored } from './today-strip-floating';
import { TodayStripLegend } from './today-strip-legend';
import {
  buildStrip,
  longDateText,
  nextStripKey,
  OVERDUE_KEY,
  popoverItems,
} from './today-strip-model';
import { TodayStripPopover } from './today-strip-popover';
import { TodayStripTooltip } from './today-strip-tooltip';
import { useFocusRescue } from './use-focus-rescue';
import { usePopoverTouchedItems } from './use-popover-touched-items';
import { useStripCaption } from './use-strip-caption';
import { useStripVisibleDays } from './use-strip-visible-days';
import './today-strip.css';

const POPOVER_MAX_WIDTH = 480;
const TOOLTIP_MAX_WIDTH = 320;

export interface TodayStripProps {
  view: TodayView;
  onItemDone: (id: string, done: boolean) => void;
  refresh: () => unknown;
}

/**
 * The 14-day strip, the screen's one accent moment. One Tab stop (roving tabindex): ←/→ move
 * between days (Home/End: first/last), focus past the visible days scrolls them into view; the
 * popover lists a day's items with tick and "Mở ghi chú"; hover/focus shows the full titles.
 */
export function TodayStrip({ view, onItemDone, refresh }: TodayStripProps) {
  const { t, i18n } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const visibleDays = useStripVisibleDays(rootRef);
  const frameRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const popoverHostRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const [open, setOpen] = useState<Anchored | null>(null);
  const [hint, setHint] = useState<Anchored | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  /** Cell to focus after the next render (set when the popover closes). */
  const focusRequest = useRef<string | null>(null);
  const [intro, setIntro] = useState(false);
  const popoverRows = usePopoverTouchedItems(open);

  // Before the first paint, so the line never flashes fully drawn first.
  useLayoutEffect(() => {
    if (claimStripIntro()) setIntro(true);
  }, []);

  const strip = useMemo(() => buildStrip(view, open?.key === OVERDUE_KEY), [view, open?.key]);
  const cells = strip.overdue ? [strip.overdue, ...strip.days] : strip.days;
  const keys = cells.map((cell) => cell.key);
  const dayKeys = useMemo(() => strip.days.map((day) => day.key), [strip.days]);
  const { caption, onScroll } = useStripCaption(dayKeys, visibleDays);
  const todayKey = strip.days[0]?.key ?? null;
  const tabStop = activeKey !== null && keys.includes(activeKey) ? activeKey : todayKey;

  const cellButton = (key: string | null) =>
    key === null
      ? null
      : (rowRef.current?.querySelector<HTMLButtonElement>(`[data-key="${key}"]`) ?? null);

  // A focused cell can also vanish later: the overdue cell goes once its last tick is confirmed,
  // which may be after the popover closed. Today's cell takes focus instead of <body>.
  useFocusRescue(rowRef, () => cellButton(todayKey), '.today-strip__cell');

  // Focus goes back to a cell after the render that closed the popover (the overdue cell may be
  // gone by then: today's cell takes it).
  useLayoutEffect(() => {
    const key = focusRequest.current;
    if (key === null) return;
    focusRequest.current = null;
    (cellButton(key) ?? cellButton(todayKey))?.focus();
  });

  // The cell toggles its own popover; anything else outside closes it (focus stays put).
  useOutsidePointerDown(
    open !== null,
    (target) =>
      popoverHostRef.current?.contains(target) === true ||
      cellButton(open?.key ?? null)?.contains(target) === true,
    () => setOpen(null),
  );

  function activate(key: string, button: HTMLButtonElement) {
    setActiveKey(key);
    setHint(null);
    setOpen((current) =>
      current?.key === key
        ? null
        : { key, left: anchorLeft(frameRef.current, button, POPOVER_MAX_WIDTH) },
    );
  }

  function showHint(key: string | null, button: HTMLButtonElement | null) {
    setHint(
      key && button ? { key, left: anchorLeft(frameRef.current, button, TOOLTIP_MAX_WIDTH) } : null,
    );
  }

  function closePopover(returnFocus: boolean) {
    const key = open?.key ?? null;
    setOpen(null);
    if (returnFocus && key !== null) {
      focusRequest.current = key;
      setActiveKey(key);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = (event.target as HTMLElement).dataset.key;
    if (current === undefined) return;
    if (event.key === 'Escape' && hint) {
      setHint(null); // WCAG 1.4.13: the tooltip can be dismissed without moving focus
      return;
    }
    const next = nextStripKey(keys, current, event.key);
    if (next === null) return;
    event.preventDefault();
    setActiveKey(next);
    const button = cellButton(next);
    button?.focus({ preventScroll: true });
    button?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  function onPopoverItemDone(id: string, done: boolean) {
    popoverRows.touch(id);
    onItemDone(id, done);
  }

  const pattern = t('today.dateFormat');
  function popoverTitle(key: string): string {
    if (key === OVERDUE_KEY)
      return t('today.strip.overdue', { count: strip.overdue?.items.length ?? 0 });
    if (key === view.date) {
      return t('today.strip.todayDate', { date: longDateText(key, i18n.language, pattern, false) });
    }
    return longDateText(key, i18n.language, pattern, true);
  }

  const hintCell =
    hint && hint.key !== open?.key ? cells.find((c) => c.key === hint.key) : undefined;
  const rootStyle = { '--today-strip-days': visibleDays } as CSSProperties;
  const renderCell = (cell: (typeof cells)[number]) => (
    <TodayStripCell
      key={cell.key}
      cell={cell}
      tabStop={cell.key === tabStop}
      expanded={open?.key === cell.key}
      popoverId={popoverId}
      onActivate={activate}
      onHint={showHint}
    />
  );

  return (
    <div
      ref={rootRef}
      className={intro ? 'today-strip is-intro' : 'today-strip'}
      data-visible-days={visibleDays}
      style={rootStyle}
    >
      <p className="today-strip__caption">{caption}</p>
      <div ref={frameRef} className="today-strip__frame">
        <div
          ref={rowRef}
          className="today-strip__row"
          role="group"
          aria-label={t('today.strip.label')}
          onKeyDown={onKeyDown}
        >
          {strip.overdue ? renderCell(strip.overdue) : null}
          <div className="today-strip__scroller" onScroll={onScroll}>
            <div className="today-strip__track">
              <span
                className="today-strip__line"
                aria-hidden="true"
                onAnimationEnd={() => setIntro(false)}
              />
              {strip.days.map(renderCell)}
            </div>
          </div>
        </div>
        {hintCell && hint ? <TodayStripTooltip cell={hintCell} left={hint.left} /> : null}
        <div ref={popoverHostRef}>
          {open ? (
            <TodayStripPopover
              id={popoverId}
              title={popoverTitle(open.key)}
              items={popoverRows.listed(popoverItems(view, open.key))}
              left={open.left}
              onClose={closePopover}
              onItemDone={onPopoverItemDone}
              refresh={refresh}
            />
          ) : null}
        </div>
      </div>
      <TodayStripLegend />
    </div>
  );
}
