import { useEffect, useRef } from 'react';
import { registerShortcut, type ShortcutDefinition } from './shortcut-registry';

/**
 * Registers a shortcut while the component is mounted. `run` may change on every render; the
 * latest one is called.
 */
export function useShortcut(definition: ShortcutDefinition): void {
  const run = useRef(definition.run);
  useEffect(() => {
    run.current = definition.run;
  });
  const { id, keys, allowInInputs, labelKey } = definition;
  useEffect(
    () =>
      registerShortcut({
        id,
        keys,
        allowInInputs,
        labelKey,
        run: (event) => run.current(event),
      }),
    [id, keys, allowInInputs, labelKey],
  );
}
