import { useRef, useState, type KeyboardEvent } from 'react';

interface ChoiceListProps {
  label: string;
  options: { value: string; label: string }[];
  current: unknown;
  onPick: (value: string) => void;
}

const STEPS: Record<string, (index: number, count: number) => number> = {
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowUp: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_index, count) => count - 1,
};

/**
 * A short list of values (status, type). It opens on the current value; ↑/↓/Home/End move
 * without changing anything, Enter (or a click) picks and saves, Esc closes the popover.
 */
export function ChoiceList({ label, options, current, onPick }: ChoiceListProps) {
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === current),
  );
  const [active, setActive] = useState(currentIndex);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent) => {
    const step = STEPS[event.key];
    if (!step || options.length === 0) return;
    event.preventDefault();
    const next = step(active, options.length);
    setActive(next);
    buttons.current[next]?.focus();
  };

  return (
    <ul className="property-choices" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option, index) => (
        <li key={option.value}>
          <button
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            className="property-choices__option"
            tabIndex={index === active ? 0 : -1}
            data-autofocus={index === currentIndex ? '' : undefined}
            aria-pressed={current === option.value}
            onFocus={() => setActive(index)}
            onClick={() => onPick(option.value)}
          >
            {option.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
