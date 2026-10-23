/**
 * Test data and setup for the Bento Today tests (co-located tests only): the Today view of
 * today-test-fixtures.ts (Tuesday 20 October 2026) plus the M5 `activity` part.
 */
import type { TodayActivity, TodayBrain } from '../../../lib/api/deadlines-types';
import type { Navigator } from '../../../lib/app-navigation';
import { installFetchMock, type FetchMock } from '../../../lib/testing/fetch-mock';
import { resetAppState } from '../../../lib/testing/reset-app-state';
import { withStyle } from '../../../lib/testing/ui-style-test-kit';
import { DEFAULT_UI_PREFS } from '../../../lib/ui-prefs';
import { useUiPrefsStore } from '../../../lib/ui-prefs-store';
import { resetAiTodayLine } from '../ai-today-line';
import { isoAddDays } from '../../../lib/local-day';
import { resetStripIntro } from '../strip-intro';
import { TODAY } from '../today-test-fixtures';
import { resetBentoIntro } from './bento-intro';

export function brain(overrides: Partial<TodayBrain> = {}): TodayBrain {
  return {
    notesNew: 0,
    notesTouched: 0,
    linksAdded: 0,
    aiTouched: 0,
    nodes: [],
    edges: [],
    ...overrides,
  };
}

/** Seven days ending today with these counts (oldest first). */
export function activity(
  counts: number[] = [0, 0, 0, 0, 0, 0, 0],
  overrides: Partial<Omit<TodayActivity, 'days'>> = {},
): TodayActivity {
  return {
    days: counts.map((count, index) => ({ date: isoAddDays(TODAY, index - 6), count })),
    doneYesterday: 0,
    brain: brain(),
    ...overrides,
  };
}

/** A clean app in the Bento style with the name of the mock and no sample-data question. */
export async function setUpBento(
  style: 'bento' | 'calm' = 'bento',
): Promise<{ mock: FetchMock; navigate: Navigator }> {
  const navigate = await resetAppState();
  resetStripIntro();
  resetBentoIntro();
  resetAiTodayLine();
  useUiPrefsStore.getState().setPrefs({ ...DEFAULT_UI_PREFS, name: 'khangnie' });
  withStyle(style);
  const mock = installFetchMock();
  mock.on('GET /api/sample-data', { body: { offered: false, present: false } });
  return { mock, navigate };
}
