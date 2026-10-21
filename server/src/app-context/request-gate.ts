/**
 * Holds API requests while the open vault is being replaced (vault switch, SPEC F18.3). New
 * requests wait at the gate instead of reaching a closing vault; the switch first lets the
 * requests already running finish (bounded wait), then closes the old vault.
 */
export interface RequestGate {
  /** Waits while the gate is closed, then counts one request in flight; returns its release. */
  enter(): Promise<() => void>;
  /** Waits while the gate is closed, without counting (long-lived WebSocket upgrades). */
  pass(): Promise<void>;
  /** Closes the gate; resolves once nothing counted is in flight or after `timeoutMs`. */
  close(timeoutMs: number): Promise<void>;
  /** Lets every waiting request through. */
  open(): void;
  readonly inFlight: number;
  /** A switch holds the gate. */
  readonly closed: boolean;
}

export function createRequestGate(): RequestGate {
  let inFlight = 0;
  let closed: { promise: Promise<void>; open: () => void } | null = null;
  const idleWaiters = new Set<() => void>();

  async function pass(): Promise<void> {
    // A loop: the gate may close again between the wake-up and this request's turn.
    while (closed) await closed.promise;
  }

  return {
    async enter() {
      await pass();
      inFlight += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        inFlight -= 1;
        if (inFlight === 0) for (const wake of [...idleWaiters]) wake();
      };
    },
    pass,
    async close(timeoutMs) {
      if (!closed) {
        let open!: () => void;
        const promise = new Promise<void>((resolve) => {
          open = resolve;
        });
        closed = { promise, open };
      }
      if (inFlight === 0) return;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          idleWaiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, timeoutMs);
        idleWaiters.add(done);
      });
    },
    open() {
      const current = closed;
      closed = null;
      current?.open();
    },
    get inFlight() {
      return inFlight;
    },
    get closed() {
      return closed !== null;
    },
  };
}
