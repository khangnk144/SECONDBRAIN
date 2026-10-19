/**
 * Runs async tasks strictly one after another. A failed task does not block the ones behind it;
 * its caller gets the rejection.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task);
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
