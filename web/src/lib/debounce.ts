export interface Debounced {
  /** (Re)starts the wait; `fn` runs once after `ms` without another call. */
  schedule: () => void;
  cancel: () => void;
}

export function debounce(fn: () => void, ms: number): Debounced {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (handle !== null) clearTimeout(handle);
      handle = setTimeout(() => {
        handle = null;
        fn();
      }, ms);
    },
    cancel() {
      if (handle !== null) clearTimeout(handle);
      handle = null;
    },
  };
}
