/**
 * Runs async tasks strictly one after another. A failed task does not block the ones behind it;
 * its caller gets the rejection.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  /**
   * Bumped when a task starts and again when it ends: two equal readings mean no task ran in
   * between (the index's change stamp, which keeps cached answers like the graph's honest).
   */
  generation = 0;

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      this.generation += 1;
      try {
        return await task();
      } finally {
        this.generation += 1;
      }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Resolves once the queue is empty, including tasks added while waiting. */
  async idle(): Promise<void> {
    for (let tail = this.tail; ; tail = this.tail) {
      await tail;
      if (tail === this.tail) return;
    }
  }
}
