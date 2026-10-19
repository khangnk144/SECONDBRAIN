import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { useId, type ReactNode, type Ref } from 'react';
import './note-panel.css';

export interface PanelSectionProps {
  title: string;
  /** Shown next to the title when above zero (backlinks, mentions). */
  count?: number;
  expanded: boolean;
  onToggle: () => void;
  /** The heading's button, for returning focus when the item that had it disappears. */
  toggleRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}

/**
 * Collapsible section of the right panel (WAI-ARIA disclosure): a heading for screen readers
 * holding a button with `aria-expanded`; the body is not rendered while collapsed.
 */
export function PanelSection({
  title,
  count,
  expanded,
  onToggle,
  toggleRef,
  children,
}: PanelSectionProps) {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const bodyId = `${baseId}-body`;
  const Caret = expanded ? CaretDown : CaretRight;

  return (
    <section className="panel-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="panel-section__heading">
        <button
          ref={toggleRef}
          type="button"
          className="panel-section__toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <Caret size={16} aria-hidden="true" focusable="false" />
          <span className="panel-section__title">{title}</span>
          {count !== undefined && count > 0 ? (
            <span className="panel-section__count">{count}</span>
          ) : null}
        </button>
      </h2>
      <div id={bodyId} className="panel-section__body" hidden={!expanded}>
        {expanded ? children : null}
      </div>
    </section>
  );
}
