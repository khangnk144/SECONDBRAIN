import { WifiSlash } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Trans } from 'react-i18next';
import { useConnectionStore } from '../../lib/ws/connection-store';
import './connection-banner.css';

/** The banner shows only after the socket has been closed this long (no flash on a quick blip). */
export const CONNECTION_BANNER_DELAY_MS = 2_000;

export interface ConnectionBannerProps {
  /**
   * `global`: the layout's banner above every screen. `inline`: a screen shows it in its own
   * flow (Today, in place of the summary line, SPEC F10); routes that do so set the handle
   * `inlineConnectionBanner` so the global one stays away.
   */
  variant?: 'global' | 'inline';
}

/** Whether the "not connected" banner should be visible now (after the 2 s grace period). */
export function useConnectionBannerVisible(): boolean {
  const state = useConnectionStore((s) => s.state);
  const closedSince = useConnectionStore((s) => s.closedSince);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (state !== 'closed' || closedSince === null) {
      setVisible(false);
      return;
    }
    const remaining = CONNECTION_BANNER_DELAY_MS - (Date.now() - closedSince);
    if (remaining <= 0) {
      setVisible(true);
      return;
    }
    const handle = setTimeout(() => setVisible(true), remaining);
    return () => clearTimeout(handle);
  }, [state, closedSince]);

  return visible;
}

/** design.md §7: "Chưa kết nối với máy chủ. Bấm đúp Mở Second Brain để khởi động." */
export function ConnectionBanner({ variant = 'global' }: ConnectionBannerProps) {
  const visible = useConnectionBannerVisible();
  if (!visible) return null;
  return (
    <p className={`connection-banner connection-banner--${variant}`} role="status">
      <WifiSlash size={18} aria-hidden="true" focusable="false" />
      <span>
        <Trans i18nKey="connection.offline" components={{ strong: <strong /> }} />
      </span>
    </p>
  );
}
