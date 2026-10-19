/**
 * One promise chain per vault: every mutation runs alone, in arrival order, so a revision check
 * and the write that follows it can never interleave with another mutation of this process.
 * (External editors are not locked out; the revision check catches them.)
 */
export interface WriteQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Refuses new tasks and resolves when the queued ones have finished. */
  close(): Promise<void>;
  readonly closed: boolean;
}

export function createWriteQueue(): WriteQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      if (closed) return Promise.reject(new Error('The vault is closed'));
      const result = tail.then(task);
      tail = result.catch(() => undefined);
      return result;
    },
    async close() {
      closed = true;
      await tail;
    },
    get closed() {
      return closed;
    },
  };
}
