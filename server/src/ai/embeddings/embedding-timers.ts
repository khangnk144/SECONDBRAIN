import type { VaultPath } from '../../vault/vault-types.js';
import type { ProviderTimers } from '../providers/provider-types.js';

/**
 * Sends at most one message per interval; a forced send (a state change) goes out at once, and a
 * throttled one is delivered at the end of the interval with the then-current values.
 */
export function createThrottledSender(
  timers: ProviderTimers,
  now: () => Date,
  intervalMs: number,
  send: () => void,
) {
  let lastSent = Number.NEGATIVE_INFINITY;
  let trailing: unknown = null;
  const sendNow = () => {
    lastSent = now().getTime();
    send();
  };
  return {
    notify(force = false): void {
      if (force || now().getTime() - lastSent >= intervalMs) {
        if (trailing !== null) timers.clearTimeout(trailing);
        trailing = null;
        sendNow();
        return;
      }
      trailing ??= timers.setTimeout(() => {
        trailing = null;
        sendNow();
      }, intervalMs);
    },
    cancel(): void {
      if (trailing !== null) timers.clearTimeout(trailing);
      trailing = null;
    },
  };
}

/** One timer per note path, restarted by every change (the 5-minute quiet period). */
export class PathTimers {
  private readonly handles = new Map<VaultPath, unknown>();

  constructor(
    private readonly timers: ProviderTimers,
    private readonly delayMs: number,
  ) {}

  get size(): number {
    return this.handles.size;
  }

  restart(path: VaultPath, fire: () => void): void {
    this.cancel(path);
    this.handles.set(
      path,
      this.timers.setTimeout(() => {
        this.handles.delete(path);
        fire();
      }, this.delayMs),
    );
  }

  cancel(path: VaultPath): void {
    const handle = this.handles.get(path);
    if (handle === undefined) return;
    this.timers.clearTimeout(handle);
    this.handles.delete(path);
  }

  clear(): void {
    for (const handle of this.handles.values()) this.timers.clearTimeout(handle);
    this.handles.clear();
  }
}
