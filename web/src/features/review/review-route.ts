/** `#/review[?end=YYYY-MM-DD]`: "Tổng kết tuần" on its own screen, any day (SPEC F26.2). */
import { withQuery } from '../../lib/api/query-string';

export const REVIEW_ROUTE = '/review';

/** The route of the week ending on `end` (no parameter = the week ending today). */
export function reviewRoute(end?: string): string {
  return withQuery(REVIEW_ROUTE, { end });
}
