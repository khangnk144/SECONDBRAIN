/**
 * "Mở Cài đặt AI": opens Settings and moves focus into its AI section once it is on screen (the
 * section loads with the settings, so it is looked for a few frames).
 */
import { navigateTo, SETTINGS_ROUTE } from '../../lib/app-navigation';

const SECTION_SELECTOR = 'section[aria-labelledby="settings-ai"]';
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled])';
const MAX_FRAMES = 120;

export function openAiSettings(): void {
  navigateTo(SETTINGS_ROUTE);
  let frames = 0;
  const look = () => {
    const section = document.querySelector<HTMLElement>(SECTION_SELECTOR);
    if (section) {
      section.scrollIntoView?.({ block: 'start' });
      section.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      return;
    }
    frames += 1;
    if (frames < MAX_FRAMES) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}
