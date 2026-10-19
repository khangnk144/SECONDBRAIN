/**
 * Runs operations one at a time in the order they were added. Every operation on a note (save,
 * property patch, rename, conflict actions, re-checks after outside changes) goes through one
 * queue, so a response is always applied to the revision the request was made against.
 */
export interface SerialQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
  /** True while an operation runs or waits. */
  busy(): boolean;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      pending += 1;
      const result = tail.then(operation);
      const settled = result.then(
        () => undefined,
        () => undefined,
      );
      tail = settled.then(() => {
        pending -= 1;
      });
      return result;
    },
    busy: () => pending > 0,
  };
}
