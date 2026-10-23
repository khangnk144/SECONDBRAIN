import { useUiStyle } from '../../lib/ui-prefs-store';
import { TodayBentoScreen } from './bento/today-bento-screen';
import { TodayCalmScreen } from './today-calm-screen';

export { TODAY_QUERY_KEY } from './use-today-data';

/**
 * Today (route `/`): the Bento grid (design.md §12.3, the default) or the calm screen
 * (design.md screen 1). Both read the same data hook (use-today-data.ts), so live updates, ticks
 * and kept rows behave the same; switching the style in Settings swaps the layout at once.
 */
export function TodayScreen() {
  return useUiStyle() === 'bento' ? <TodayBentoScreen /> : <TodayCalmScreen />;
}
