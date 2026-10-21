/**
 * Web Notifications for reminders (SPEC F17: one notification across the open app windows, the
 * Windows toast stays the server's job). A reminder event reaches every window; one of them shows
 * the notification:
 * - with `navigator.locks`, the window holding the `sb-reminders-leader` lock (the others wait in
 *   line for it, so the next window takes over when the leader closes);
 * - without it, every window claims the reminder on `BroadcastChannel('sb-reminders')` and the
 *   earliest claim wins after a short wait.
 * The notification's `tag` is the reminder key as well, so a browser never stacks two of them.
 * Nothing happens unless the permission is `granted`; asking for it needs a click (Settings).
 */
import type { ReminderEntry } from '../../lib/api/reminders-types';

export const REMINDERS_CHANNEL = 'sb-reminders';
export const LEADER_LOCK = 'sb-reminders-leader';
/** How long a window waits for other windows' claims before deciding (no Web Locks). */
export const CLAIM_WAIT_MS = 150;

export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface LocksLike {
  request(
    name: string,
    options: { signal?: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<unknown>;
}

export type PermissionState = NotificationPermission | 'unsupported';

export interface ReminderNotifierDeps {
  windowId: string;
  createChannel: (() => ChannelLike) | null;
  locks: LocksLike | null;
  permission: () => PermissionState;
  /** Shows the notification; `onClick` focuses this window and opens the note. */
  show: (entry: ReminderEntry, onClick: () => void) => void;
  open: (entry: ReminderEntry) => void;
  now?: () => number;
}

interface Claim {
  key: string;
  windowId: string;
  at: number;
}

const earlier = (a: Claim, b: Claim) =>
  a.at !== b.at ? a.at < b.at : a.windowId.localeCompare(b.windowId) < 0;

export interface ReminderNotifier {
  /** A `reminder` event arrived in this window. */
  handle(entry: ReminderEntry): void;
  isLeader(): boolean;
  stop(): void;
}

export function createReminderNotifier(deps: ReminderNotifierDeps): ReminderNotifier {
  const now = deps.now ?? (() => Date.now());
  const shown = new Set<string>();
  const claims = new Map<string, Claim>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let leader = false;
  let releaseLeader: (() => void) | null = null;
  const abort = typeof AbortController === 'function' ? new AbortController() : null;

  if (deps.locks) {
    deps.locks
      .request(LEADER_LOCK, { signal: abort?.signal }, () => {
        leader = true;
        // Held until this window stops (page closed): the next waiting window then leads.
        return new Promise<void>((resolve) => (releaseLeader = resolve));
      })
      .catch(() => undefined); // aborted on stop
  }

  const channel = deps.locks ? null : (deps.createChannel?.() ?? null);
  const onMessage = (event: MessageEvent) => {
    const claim = event.data as Partial<Claim> | null;
    if (!claim || typeof claim.key !== 'string' || typeof claim.windowId !== 'string') return;
    if (typeof claim.at !== 'number') return;
    const known = claims.get(claim.key);
    if (!known || earlier(claim as Claim, known)) claims.set(claim.key, claim as Claim);
  };
  channel?.addEventListener('message', onMessage);

  function show(entry: ReminderEntry): void {
    if (shown.has(entry.key)) return;
    shown.add(entry.key);
    try {
      deps.show(entry, () => deps.open(entry));
    } catch {
      // A browser that refuses the notification (permission revoked meanwhile): the list has it.
    }
  }

  function claimAndShow(entry: ReminderEntry): void {
    const mine: Claim = { key: entry.key, windowId: deps.windowId, at: now() };
    const known = claims.get(entry.key);
    if (!known || earlier(mine, known)) claims.set(entry.key, mine);
    channel?.postMessage(mine);
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (claims.get(entry.key)?.windowId === deps.windowId) show(entry);
    }, CLAIM_WAIT_MS);
    timers.add(timer);
  }

  return {
    handle(entry) {
      // The server's Windows toast already told her; the in-app list shows it either way.
      if (entry.toast === 'shown' || entry.dismissed) return;
      if (deps.permission() !== 'granted') return;
      if (deps.locks) {
        if (leader) show(entry);
        return;
      }
      claimAndShow(entry);
    },
    isLeader: () => leader,
    stop() {
      abort?.abort();
      releaseLeader?.();
      leader = false;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      channel?.removeEventListener('message', onMessage);
      channel?.close();
    },
  };
}
