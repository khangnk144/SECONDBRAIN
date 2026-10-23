import { beforeEach, describe, expect, it } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useVaultStore } from '../../lib/vault-store';
import { dismissReview, isoWeekOf, isReviewDismissed, isSunday } from './review-week';
import { REVIEW_COMMANDS } from './review-commands';

beforeEach(async () => {
  await resetAppState('vault-a');
});

describe('weekly review calendar rules (F26.1, F26.2)', () => {
  it('knows Sundays and ISO weeks across year ends', () => {
    expect(isSunday('2026-03-08')).toBe(true);
    expect(isSunday('2026-03-07')).toBe(false);
    expect(isSunday('2026-03-09')).toBe(false);
    expect(isSunday('2026-02-30')).toBe(false);
    expect(isoWeekOf('2026-03-08')).toBe('2026-W10');
    expect(isoWeekOf('2026-03-09')).toBe('2026-W11');
    // 1 January 2027 is a Friday: still week 53 of 2026; 3 January 2027 (Sunday) too.
    expect(isoWeekOf('2027-01-03')).toBe('2026-W53');
    expect(isoWeekOf('2027-01-04')).toBe('2027-W01');
    expect(isoWeekOf('2024-12-29')).toBe('2024-W52');
    expect(isoWeekOf('2024-12-30')).toBe('2025-W01');
  });

  it('(F26.2) "Để sau" counts for that week of that vault only', () => {
    dismissReview('2026-03-08');
    expect(isReviewDismissed('2026-03-08')).toBe(true);
    expect(isReviewDismissed('2026-03-15')).toBe(false);
    useVaultStore.setState({ vaultId: 'vault-b' });
    expect(isReviewDismissed('2026-03-08')).toBe(false);
  });

  it('(F26.2) the palette command opens #/review', () => {
    expect(REVIEW_COMMANDS.map((command) => [command.id, command.labelKey])).toEqual([
      ['weekly-review', 'review.command'],
    ]);
  });
});
