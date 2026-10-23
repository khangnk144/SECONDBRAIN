import { X } from '@phosphor-icons/react';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { focusableElements } from '../features/dialogs/use-focus-trap';
import { useOverlayFocus } from './use-overlay-focus';
import './shell-overlay.css';

export interface ShellOverlayProps {
  id: string;
  /** `left`: a drawer sliding in from the left; `bottom`: a sheet rising from the bottom. */
  side: 'left' | 'bottom';
  /** A visible heading that names the overlay … */
  title?: string;
  /** … or the id of a heading inside the content … */
  labelledBy?: string;
  /** … or a name for screen readers only. */
  label?: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}

/** Clicks here are not "outside": an open modal on top, or the button that toggles the overlay. */
function isOutside(target: Node, panel: HTMLElement, id: string): boolean {
  if (panel.contains(target)) return false;
  const element = target instanceof Element ? target : target.parentElement;
  if (!element) return true;
  if (element.closest(`[aria-controls="${id}"], [data-overlay-toggle="${id}"]`)) return false;
  return element.closest('[aria-modal="true"], .modal-backdrop, .capture-layer') === null;
}

/**
 * Drawer / bottom sheet of the shell (F35.2 folder drawer, F28.1 phone layouts): a modal panel
 * over the content. Focus moves in on open, Tab stays inside, Esc, the close button and a click
 * outside close it, and focus goes back to the button that opened it (unless a navigation
 * closed it: then focus follows the new screen). Global shortcuts keep working, so `Alt+1` /
 * `Alt+2` close what they opened. Esc is handled after the content's own handlers: a tree rename
 * or a context menu that answers Esc (preventDefault) closes first.
 */
export function ShellOverlay({
  id,
  side,
  title,
  labelledBy,
  label,
  onClose,
  className,
  children,
}: ShellOverlayProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useOverlayFocus(panelRef);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const panel = panelRef.current;
      if (panel && event.target instanceof Node && isOutside(event.target, panel, id)) {
        onCloseRef.current();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [id]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const items = focusableElements(panelRef.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const headingId = `${id}-title`;
  const classes = ['shell-overlay__panel', `shell-overlay__panel--${side}`];
  if (className) classes.push(className);
  return (
    <div className={`shell-overlay shell-overlay--${side}`}>
      <div className="shell-overlay__scrim" aria-hidden="true" />
      <div
        ref={panelRef}
        id={id}
        className={classes.join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? headingId : labelledBy}
        aria-label={title || labelledBy ? undefined : label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="shell-overlay__head">
          {title ? (
            <h2 id={headingId} className="shell-overlay__title">
              {title}
            </h2>
          ) : null}
          <button
            type="button"
            className="icon-button shell-overlay__close"
            aria-label={t('rail.close')}
            title={t('rail.close')}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" focusable="false" />
          </button>
        </div>
        <div className="shell-overlay__body">{children}</div>
      </div>
    </div>
  );
}
