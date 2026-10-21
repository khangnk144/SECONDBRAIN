/**
 * "Mở Cài đặt AI" / "Mở Kết nối Claude": opens Settings and moves focus to that section's heading
 * (`settings-ai`, `settings-mcp`: the ids of the Settings sections), so the next Tab lands on its
 * first control. Settings loads its data first, so the heading is waited for (up to 3 s).
 */
import { navigateTo, SETTINGS_ROUTE } from '../../lib/app-navigation';

export type AiSettingsSection = 'ai' | 'mcp';

const WAIT_MS = 3_000;

export function openAiSettings(section: AiSettingsSection = 'ai'): void {
  navigateTo(SETTINGS_ROUTE);
  const id = `settings-${section}`;
  const until = Date.now() + WAIT_MS;
  const tick = () => {
    const heading = document.getElementById(id);
    if (!heading) {
      if (Date.now() < until) window.setTimeout(tick, 50);
      return;
    }
    // A heading is not focusable by itself; -1 keeps it out of the Tab order.
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
    heading.scrollIntoView?.({ block: 'start' });
  };
  window.setTimeout(tick, 0);
}
