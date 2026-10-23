import { Pause, Play } from '@phosphor-icons/react';
import { useId, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLongDate } from '../../lib/format-long-date';
import type { GraphModel } from './graph-model';
import type { TimeTravel } from './use-graph-time-travel';
import './graph-time.css';

/** PageUp / PageDown move this many weeks. */
const PAGE_WEEKS = 4;

export interface GraphTimeScrubberProps {
  /** Mondays (`YYYY-MM-DD`), oldest first; the last is the current week (the live map). */
  weeks: readonly string[];
  position: number;
  onChange: (week: number) => void;
  /** Notes and links on the map at that week. */
  counts: { notes: number; links: number };
  playing: boolean;
  onPlay: () => void;
  onStop: () => void;
  reducedMotion: boolean;
  /** The chosen week is before the app watched the vault: the history is estimated. */
  approximate: boolean;
}

function mondayDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/**
 * "Tua thời gian" under the brain map (SPEC F24.1, design.md screen 6): one step per week, from
 * the first week of the history to now. `←`/`→` move a week, `Home`/`End` go to the first week
 * and back to now, PageUp/PageDown move four weeks. "Phát" plays the weeks in order; under
 * reduced motion it is off and a sentence says why.
 */
export function GraphTimeScrubber(props: GraphTimeScrubberProps) {
  const { weeks, position, onChange, counts, playing, reducedMotion } = props;
  const { t, i18n } = useTranslation();
  const noteId = useId();
  const last = weeks.length - 1;
  const monday = weeks[Math.min(position, last)] ?? '';
  const date = formatLongDate(mondayDate(monday), i18n.language, t('graph.time.dateFormat'));
  const week =
    position >= last ? t('graph.time.weekNow', { date }) : t('graph.time.week', { date });
  const countText = t('graph.time.counts', {
    notes: t('graph.time.notes', { count: counts.notes }),
    links: t('graph.time.links', { count: counts.links }),
  });

  if (weeks.length < 2) {
    return (
      <section className="graph-time" aria-label={t('graph.time.label')} data-graph-overlay>
        <p className="graph-time__note">{t('graph.time.single')}</p>
      </section>
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: position - 1,
      ArrowDown: position - 1,
      ArrowRight: position + 1,
      ArrowUp: position + 1,
      PageDown: position - PAGE_WEEKS,
      PageUp: position + PAGE_WEEKS,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange(Math.min(last, Math.max(0, next)));
  };

  return (
    <section className="graph-time" aria-label={t('graph.time.label')} data-graph-overlay>
      <div className="graph-time__row">
        <button
          type="button"
          className="button button--secondary graph-time__play"
          onClick={playing ? props.onStop : props.onPlay}
          disabled={reducedMotion}
          aria-describedby={reducedMotion ? noteId : undefined}
        >
          {playing ? (
            <Pause size={16} aria-hidden="true" focusable="false" />
          ) : (
            <Play size={16} aria-hidden="true" focusable="false" />
          )}
          {playing ? t('graph.time.stop') : t('graph.time.play')}
        </button>
        <input
          type="range"
          className="graph-time__range"
          min={0}
          max={last}
          step={1}
          value={Math.min(position, last)}
          aria-label={t('graph.time.slider')}
          aria-valuetext={t('graph.time.valueText', { week, counts: countText })}
          onChange={(event) => onChange(Number(event.target.value))}
          onKeyDown={onKeyDown}
        />
        <p className="graph-time__label">
          <span className="graph-time__week">{week}</span>
          <span className="graph-time__counts">{countText}</span>
        </p>
      </div>
      {props.approximate ? <p className="graph-time__note">{t('graph.time.approximate')}</p> : null}
      {reducedMotion ? (
        <p id={noteId} className="graph-time__note">
          {t('graph.time.reducedMotion')}
        </p>
      ) : null}
    </section>
  );
}

/** The scrubber for the screen's time travel state and the map it shows (null: no history). */
export function GraphTimeBar(props: {
  time: TimeTravel;
  model: GraphModel | null;
  reducedMotion: boolean;
}) {
  const { time, model } = props;
  const history = time.history;
  if (!history) return null;
  const weekEnd = history.weekEnds[time.position] ?? Number.POSITIVE_INFINITY;
  const exactSince = history.exactSince;
  return (
    <GraphTimeScrubber
      weeks={history.weeks}
      position={time.position}
      onChange={time.goTo}
      counts={{
        notes: model?.nodes.filter((node) => node.kind === 'note').length ?? 0,
        links: model?.edgeSource.length ?? 0,
      }}
      playing={time.playing}
      onPlay={time.play}
      onStop={time.stop}
      reducedMotion={props.reducedMotion}
      approximate={!time.live && (exactSince === null || weekEnd <= exactSince)}
    />
  );
}
