import { Fragment } from 'react';
import { splitHighlights, type HighlightRange } from './highlight-ranges';
import './highlighted-text.css';

/** Text with the given ranges wrapped in `<mark>` (`--accent-soft`, design.md screen 5). */
export function HighlightedText({
  text,
  ranges,
}: {
  text: string;
  ranges: readonly HighlightRange[];
}) {
  return (
    <>
      {splitHighlights(text, ranges).map((part, index) =>
        part.marked ? (
          <mark key={index} className="text-highlight">
            {part.text}
          </mark>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
