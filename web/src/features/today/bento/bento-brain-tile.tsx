import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { TodayActivity } from '../../../lib/api/deadlines-types';
import { BrainConstellation } from '../brain-constellation';
import type { BrainLayoutBox } from '../brain-layout';
import { brainTitles, GRAPH_TODAY_ROUTE, hasBrainActivity, openGraphToday } from '../brain-summary';

const TILE_BOX: BrainLayoutBox = { width: 160, height: 84, minR: 3.5, maxR: 8, limit: 24 };

export interface BentoBrainTileProps {
  /** Undefined while loading or from an older server; null when the server could not read it. */
  activity: TodayActivity | null | undefined;
  loading: boolean;
}

/**
 * "Não hôm nay" (3 columns, SPEC F24.4): the mini constellation of the notes touched today, the
 * chips "+n ghi chú", "+n liên kết" and "AI cập nhật n trang" (when > 0), all counted by the
 * server from today's events. The whole tile opens the brain map filtered to today (its heading
 * link stretches over the tile). Screen readers get the picture's name and the titles as text.
 */
export function BentoBrainTile({ activity, loading }: BentoBrainTileProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const brain = activity?.brain;
  const active = brain !== undefined && hasBrainActivity(brain);

  return (
    <section className="tile today-tile today-tile--brain" aria-labelledby={headingId}>
      {/* The region is named by the title alone; the link says where it goes (one name, no
          visually hidden piece that Chromium would join with a stray space, E2E D5). */}
      <h2 className="today-tile__title">
        <a
          className="today-brain__link"
          href={`#${GRAPH_TODAY_ROUTE}`}
          aria-label={t('today.bento.brain.open', { title: t('today.bento.brain.title') })}
          onClick={openGraphToday}
        >
          <span id={headingId}>{t('today.bento.brain.title')}</span>
        </a>
      </h2>
      {loading ? null : !brain ? (
        <p className="today-tile__empty">{t('today.bento.unavailable')}</p>
      ) : !active ? (
        <p className="today-tile__empty">{t('today.bento.brain.empty')}</p>
      ) : (
        <>
          {brain.nodes.length > 0 ? (
            <BrainConstellation
              brain={brain}
              box={TILE_BOX}
              className="today-brain__map"
              label={t('today.bento.brain.map', { count: brain.nodes.length })}
            />
          ) : null}
          <ul className="today-chips">
            <li className="today-chip today-chip--notes">
              {t('today.bento.brain.notes', { count: brain.notesTouched })}
            </li>
            <li className="today-chip today-chip--links">
              {t('today.bento.brain.links', { count: brain.linksAdded })}
            </li>
            {brain.aiTouched > 0 ? (
              <li className="today-chip today-chip--ai">
                {t('today.bento.brain.ai', { count: brain.aiTouched })}
              </li>
            ) : null}
          </ul>
          {brain.nodes.length > 0 ? (
            <p className="visually-hidden">
              {t('today.bento.brain.titles', { titles: brainTitles(brain, t) })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
