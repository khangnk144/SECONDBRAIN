import type { AppRouteHandle } from './routes';
import type { ShellView } from './shell-view';

/** What the layout hands to the calm and the bento frame. */
export interface FrameProps {
  handle: AppRouteHandle;
  view: ShellView;
  /** ≤ 600 px (phones). */
  compact: boolean;
  /** Key of the routed screen (see `useScreenKey` in app-layout.tsx). */
  screenKey: string;
  /** For the toggle buttons: the left / right side is not on screen. */
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}
