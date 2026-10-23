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
import { TodayStripHead } from './today-strip-head';
import { TodayStripLegend } from './today-strip-legend';
import { stripPopoverTitle } from './strip-popover-title';
import { buildStrip, OVERDUE_KEY, popoverItems } from './today-strip-model';
import { TodayStripPopover } from './today-strip-popover';
import { TodayStripTooltip } from './today-strip-tooltip';
import { usePopoverTouchedItems } from './use-popover-touched-items';
import { useStripCaption } from './use-strip-caption';
import { useStripPopover } from './use-strip-popover';
import { useStripRoving } from './use-strip-roving';
import { useStripVisibleDays } from './use-strip-visible-days';
import './today-strip.css';
import './today-strip-bento.css';

export interface TodayStripProps {
  view: TodayView;
  onItemDone: (id: string, done: boolean) => void;
  refresh: () => unknown;
  /**
   * `bento`: cells as rounded boxes with a 28×6 urgency bar instead of the dot, under a heading
   * (`headingId`) instead of the caption; every behaviour stays the same (design.md §12.3).
   */
  variant?: 'calm' | 'bento';
  headingId?: string;
}

/**
 * The 14-day strip, the screen's one accent moment. One Tab stop (roving tabindex): ←/→ move
 * between days (Home/End: first/last), focus past the visible days scrolls them into view; the
 * popover lists a day's items with tick and "Mở ghi chú"; hover/focus shows the full titles.
 */
export function TodayStrip({
  view,
  onItemDone,
  refresh,
  variant = 'calm',
  headingId,
}: TodayStripProps) {
  const { t, i18n } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const visibleDays = useStripVisibleDays(rootRef, { variant, scroller: scrollerRef });
  const frameRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const popoverHostRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const popover = useStripPopover({ frame: frameRef, row: rowRef, popoverHost: popoverHostRef });
  const { open, hint } = popover;
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
  const { caption, range, onScroll } = useStripCaption(dayKeys, visibleDays);
  const bento = variant === 'bento';
  const roving = useStripRoving(rowRef, keys, strip.days[0]?.key ?? null);

  function activate(key: string, button: HTMLButtonElement) {
    roving.setActiveKey(key);
    popover.toggle(key, button);
  }

  function closePopover(returnFocus: boolean) {
    const key = open?.key ?? null;
    popover.close();
    if (returnFocus && key !== null) roving.requestFocus(key);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = (event.target as HTMLElement).dataset.key;
    if (current === undefined) return;
    if (event.key === 'Escape' && hint) {
      popover.hideHint(); // WCAG 1.4.13: the tooltip can be dismissed without moving focus
      return;
    }
    roving.onKeyDown(event, current);
  }

  function onPopoverItemDone(id: string, done: boolean) {
    popoverRows.touch(id);
    onItemDone(id, done);
  }

  const hintCell =
    hint && hint.key !== open?.key ? cells.find((c) => c.key === hint.key) : undefined;
  const rootStyle = { '--today-strip-days': visibleDays } as CSSProperties;
  const renderCell = (cell: (typeof cells)[number], index: number) => (
    <TodayStripCell
      key={cell.key}
      cell={cell}
      introIndex={bento ? index : undefined}
      tabStop={cell.key === roving.tabStop}
      expanded={open?.key === cell.key}
      popoverId={popoverId}
      onActivate={activate}
      onHint={popover.showHint}
    />
  );

  const classes = ['today-strip'];
  if (bento) classes.push('today-strip--bento');
  if (intro) classes.push('is-intro');
  return (
    <div
      ref={rootRef}
      className={classes.join(' ')}
      data-visible-days={visibleDays}
      style={rootStyle}
    >
      {bento ? (
        <TodayStripHead
          headingId={headingId ?? ''}
          range={range}
          overdue={strip.overdue?.items.length ?? 0}
        />
      ) : (
        <p className="today-strip__caption">{caption}</p>
      )}
      <div ref={frameRef} className="today-strip__frame">
        <div
          ref={rowRef}
          className="today-strip__row"
          role="group"
          aria-label={t('today.strip.label')}
          onKeyDown={onKeyDown}
        >
          {strip.overdue ? renderCell(strip.overdue, 0) : null}
          <div ref={scrollerRef} className="today-strip__scroller" onScroll={onScroll}>
            <div className="today-strip__track">
              <span
                className="today-strip__line"
                aria-hidden="true"
                onAnimationEnd={() => setIntro(false)}
              />
              {strip.days.map((day, index) => renderCell(day, index + (strip.overdue ? 1 : 0)))}
            </div>
          </div>
        </div>
        {hintCell && hint ? <TodayStripTooltip cell={hintCell} left={hint.left} /> : null}
        <div ref={popoverHostRef}>
          {open ? (
            <TodayStripPopover
              id={popoverId}
              title={stripPopoverTitle(
                open.key,
                view.date,
                strip.overdue?.items.length ?? 0,
                i18n.language,
                t,
              )}
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
