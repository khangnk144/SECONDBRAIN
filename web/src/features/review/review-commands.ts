/** Palette command "Tổng kết tuần" (SPEC F26.2, F8 registry): opens `#/review` any day. */
import type { AppCommand } from '../../lib/commands/command-registry';
import { navigateTo } from '../../lib/app-navigation';
import { REVIEW_ROUTE } from './review-route';

export const REVIEW_COMMANDS: readonly AppCommand[] = [
  {
    id: 'weekly-review',
    labelKey: 'review.command',
    keywords: ['review', 'week', 'weekly', 'tổng kết', 'tuần', 'inbox', 'chủ nhật', 'sunday'],
    feature: 'today',
    run: () => navigateTo(REVIEW_ROUTE),
  },
];
