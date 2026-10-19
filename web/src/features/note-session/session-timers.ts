export type TimerName = 'draftTimer' | 'autosaveTimer' | 'retryTimer';

/** The session's timers: one handle per name, restarted or cleared by name. */
export class SessionTimers {
  private handles: Record<TimerName, ReturnType<typeof setTimeout> | null> = {
    draftTimer: null,
    autosaveTimer: null,
    retryTimer: null,
  };

  start(name: TimerName, delayMs: number, run: () => void): void {
    this.clear(name);
    this.handles[name] = setTimeout(() => {
      this.handles[name] = null;
      run();
    }, delayMs);
  }

  pending(name: TimerName): boolean {
    return this.handles[name] !== null;
  }

  clear(name: TimerName): void {
    const handle = this.handles[name];
    if (handle !== null) clearTimeout(handle);
    this.handles[name] = null;
  }

  clearAll(): void {
    this.clear('draftTimer');
    this.clear('autosaveTimer');
    this.clear('retryTimer');
  }
}
