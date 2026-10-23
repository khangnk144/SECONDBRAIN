/**
 * "Não hôm nay" (SPEC F24.4) in words, for the calm block and the Bento tile: the counts of
 * today's events as the server sent them (never estimated here) and the link to the brain map
 * filtered to today (`#/graph?when=today`, the graph's URL contract).
 */
import type { TFunction } from 'i18next';
import type { MouseEvent } from 'react';
import type { TodayBrain } from '../../lib/api/deadlines-types';
import { GRAPH_ROUTE, navigateTo } from '../../lib/app-navigation';
import { wantsNewTab } from '../backlinks/open-note-at-line';

export const GRAPH_TODAY_ROUTE = `${GRAPH_ROUTE}?when=today`;

/** Titles read out by the screen-reader text before "và n ghi chú khác". */
const SPOKEN_TITLES = 5;

export function hasBrainActivity(brain: TodayBrain): boolean {
  return (
    brain.notesTouched > 0 || brain.linksAdded > 0 || brain.aiTouched > 0 || brain.nodes.length > 0
  );
}

/** "2 ghi chú mới, 1 ghi chú đã sửa, 7 liên kết mới, AI cập nhật 3 trang" (zero parts left out). */
export function brainSentence(brain: TodayBrain, t: TFunction): string {
  const edited = Math.max(0, brain.notesTouched - brain.notesNew);
  const parts: string[] = [];
  if (brain.notesNew > 0) parts.push(t('today.brain.newNotes', { count: brain.notesNew }));
  if (edited > 0) parts.push(t('today.brain.editedNotes', { count: edited }));
  if (brain.linksAdded > 0) parts.push(t('today.brain.newLinks', { count: brain.linksAdded }));
  if (brain.aiTouched > 0) parts.push(t('today.brain.aiPages', { count: brain.aiTouched }));
  return parts.join(t('today.brain.separator'));
}

/** The map's titles for screen readers: the first five, then how many more. */
export function brainTitles(brain: TodayBrain, t: TFunction): string {
  const titles = brain.nodes.slice(0, SPOKEN_TITLES).map((node) => node.title);
  const rest = brain.nodes.length - titles.length;
  const list = titles.join(t('today.brain.separator'));
  return rest > 0 ? t('today.brain.titlesMore', { titles: list, count: rest }) : list;
}

/** In-app navigation to the brain map on today's notes; Ctrl/middle click keep the browser's way. */
export function openGraphToday(event: MouseEvent<HTMLAnchorElement>): void {
  if (wantsNewTab(event) || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigateTo(GRAPH_TODAY_ROUTE);
}
