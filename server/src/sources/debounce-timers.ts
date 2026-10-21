/**
 * Keyed quiet-period timers: the action runs once no new call for its key came in for `ms`
 * (a PDF still being copied fires many change events). Timers never keep the process alive.
 */
export class DebounceTimers {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly ms: number) {}

  later(key: string, action: () => void): void {
    this.cancel(key);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      action();
    }, this.ms);
    timer.unref();
    this.timers.set(key, timer);
  }

  cancel(key: string): void {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
