import { useTranslation } from 'react-i18next';
import type { TodayActivity } from '../../lib/api/deadlines-types';
import { BrainConstellation } from './brain-constellation';
import type { BrainLayoutBox } from './brain-layout';
import {
  brainSentence,
  GRAPH_TODAY_ROUTE,
  hasBrainActivity,
  openGraphToday,
} from './brain-summary';

const MINI_BOX: BrainLayoutBox = { width: 56, height: 28, minR: 2, maxR: 3.5, limit: 6 };

/**
 * Calm Today's small "não hôm nay" block, top right (design.md screen 6, SPEC F24.4): a few dots
 * for the notes touched today and "3 ghi chú mới, 7 liên kết mới"; a click opens the brain map on
 * today's notes. Quiet by design: nothing at all on a day without activity (or without data).
 */
export function TodayBrainLine({ activity }: { activity: TodayActivity | null | undefined }) {
  const { t } = useTranslation();
  const brain = activity?.brain;
  if (!brain || !hasBrainActivity(brain)) return null;
  const summary = brainSentence(brain, t);
  return (
    <a
      className="today-brain-line"
      href={`#${GRAPH_TODAY_ROUTE}`}
      aria-label={t('today.brain.link', { summary })}
      onClick={openGraphToday}
    >
      {brain.nodes.length > 0 ? (
        <BrainConstellation brain={brain} box={MINI_BOX} className="today-brain-line__map" />
      ) : null}
      <span className="today-brain-line__text">{summary}</span>
    </a>
  );
}
