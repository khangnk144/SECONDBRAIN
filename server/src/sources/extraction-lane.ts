/**
 * One extraction at a time per vault (SPEC F30.3). Tasks are keyed by content hash: asking again
 * for a hash that is queued or running joins that task instead of extracting twice. A priority
 * task (someone is waiting for the text right now) goes before every background task.
 */

export class LaneClosedError extends Error {
  constructor() {
    super('The extraction lane is closed.');
    this.name = 'LaneClosedError';
  }
}

interface Task<T> {
  key: string;
  priority: boolean;
  run: () => Promise<T>;
  promise: Promise<T>;
  settle: { resolve: (value: T) => void; reject: (error: unknown) => void };
}

export class ExtractionLane<T> {
  private readonly queue: Task<T>[] = [];
  private running: Task<T> | null = null;
  private closed = false;

  run(key: string, work: () => Promise<T>, priority: boolean): Promise<T> {
    if (this.closed) return Promise.reject(new LaneClosedError());
    if (this.running?.key === key) return this.running.promise;
    const queued = this.queue.find((task) => task.key === key);
    if (queued) {
      if (priority && !queued.priority) {
        this.queue.splice(this.queue.indexOf(queued), 1);
        queued.priority = true;
        this.insert(queued);
      }
      return queued.promise;
    }
    let settle!: Task<T>['settle'];
    const promise = new Promise<T>((resolve, reject) => (settle = { resolve, reject }));
    this.insert({ key, priority, run: work, promise, settle });
    this.pump();
    return promise;
  }

  /** Priority tasks after the other priority tasks, before every background task. */
  private insert(task: Task<T>): void {
    const at = task.priority ? this.queue.findIndex((t) => !t.priority) : -1;
    if (at === -1) this.queue.push(task);
    else this.queue.splice(at, 0, task);
  }

  private pump(): void {
    if (this.running || this.queue.length === 0) return;
    const task = this.queue.shift()!;
    this.running = task;
    void task
      .run()
      .then(task.settle.resolve, task.settle.reject)
      .finally(() => {
        this.running = null;
        this.pump();
      });
  }

  /** Rejects queued tasks; resolves when the running one has finished. */
  async close(): Promise<void> {
    this.closed = true;
    for (const task of this.queue.splice(0)) task.settle.reject(new LaneClosedError());
    await this.running?.promise.catch(() => undefined);
  }
}
