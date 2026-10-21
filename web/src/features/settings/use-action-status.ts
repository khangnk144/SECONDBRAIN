import { useCallback, useEffect, useRef, useState } from 'react';

export type ActionState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

/**
 * A Settings button that does something on the server: busy while it runs (the button is
 * disabled, so a double click never runs it twice), then a sentence saying what happened.
 */
export function useActionStatus(): {
  state: ActionState;
  run: (action: () => Promise<string | null>, onError: (error: unknown) => string) => Promise<void>;
  set: (state: ActionState) => void;
} {
  const [state, setState] = useState<ActionState>({ kind: 'idle' });
  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const set = useCallback((next: ActionState) => {
    if (mounted.current) setState(next);
  }, []);
  const run = useCallback(
    async (action: () => Promise<string | null>, onError: (error: unknown) => string) => {
      if (busy.current) return;
      busy.current = true;
      set({ kind: 'busy' });
      try {
        const message = await action();
        set(message === null ? { kind: 'idle' } : { kind: 'done', message });
      } catch (error) {
        set({ kind: 'error', message: onError(error) });
      } finally {
        busy.current = false;
      }
    },
    [set],
  );
  return { state, run, set };
}
