import { useCallback, useEffect, useRef, useState } from 'react';
import { useCaptureUi } from '../../lib/capture-ui-store';
import { focusIsLost, focusMainRegion } from '../../lib/focus-recovery';
import { CaptureBox } from './capture-box';
import './capture-overlay.css';

/** The box shrinks toward the toast corner in this time (design.md §6). */
export const CAPTURE_LEAVE_MS = 250;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/**
 * Quick capture (SPEC F12), mounted once by the layout and opened by `Alt+Q` or the palette.
 * After a save the open box is gone at once (focus is already back where it was) and a copy of
 * it, hidden from assistive technology, shrinks toward the corner where the "Đã lưu vào Inbox"
 * toast appears; with reduced motion nothing moves.
 */
export function CaptureOverlay() {
  const isOpen = useCaptureUi((state) => state.isOpen);
  const [leaving, setLeaving] = useState<string | null>(null);
  const wasOpen = useRef(false);

  const onSaved = useCallback((text: string) => {
    if (!prefersReducedMotion()) setLeaving(text);
  }, []);

  // Opened with nothing focused (page just loaded): leave focus somewhere useful, not on <body>.
  useEffect(() => {
    if (wasOpen.current && !isOpen && focusIsLost()) focusMainRegion();
    wasOpen.current = isOpen;
  }, [isOpen]);

  if (isOpen) return <CaptureBox onSaved={onSaved} />;
  return leaving === null ? null : <LeavingBox text={leaving} onDone={() => setLeaving(null)} />;
}

function LeavingBox({ text, onDone }: { text: string; onDone: () => void }) {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  // animationend may never come (tab hidden, styles not loaded): stop a little after it should.
  useEffect(() => {
    const timer = setTimeout(() => done.current(), CAPTURE_LEAVE_MS + 100);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="capture-layer capture-layer--leaving" aria-hidden="true">
      <div className="capture-box capture-box--leaving" onAnimationEnd={() => done.current()}>
        <p className="capture-box__ghost">{text}</p>
      </div>
    </div>
  );
}
