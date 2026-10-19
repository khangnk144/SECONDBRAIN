import { X } from '@phosphor-icons/react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { focusIsLost, focusOrMain } from '../../lib/focus-recovery';
import { useToastStore, type Toast } from '../../lib/toast-store';

export interface ToastItemProps {
  toast: Toast;
  /** Element that had focus before focus moved into the toast region (keyboard users). */
  focusBeforeToasts: () => HTMLElement | null;
}

/** One toast: message, optional action button, close button. Hover/focus pauses the countdown. */
export function ToastItem({ toast, focusBeforeToasts }: ToastItemProps) {
  const { t } = useTranslation();
  const { dismiss, pause, resume } = useToastStore.getState();

  /**
   * The toast (and the focused button) disappears: focus goes back to where the user was – the
   * element focused before entering the toasts, else the one focused when the toast appeared –
   * or to the main region when that element is gone.
   */
  function close(event: MouseEvent<HTMLButtonElement>): HTMLElement | null {
    const host = event.currentTarget.closest('.toast-host');
    const usable = (el: HTMLElement | null) => (el && !host?.contains(el) ? el : null);
    const target = usable(focusBeforeToasts()) ?? usable(toast.origin);
    const hadFocus = host?.contains(document.activeElement) ?? false;
    dismiss(toast.id);
    if (hadFocus || focusIsLost()) focusOrMain(target);
    return target;
  }

  async function runAction(event: MouseEvent<HTMLButtonElement>) {
    const target = close(event);
    await toast.action?.run();
    // The action may have removed that element too (an undo re-creates tree rows).
    if (focusIsLost()) focusOrMain(target);
  }

  return (
    <li
      className={toast.tone === 'error' ? 'toast toast--error' : 'toast'}
      onMouseEnter={() => pause(toast.id)}
      onMouseLeave={() => resume(toast.id)}
      onFocus={() => pause(toast.id)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume(toast.id);
      }}
    >
      <span className="toast__message">{toast.message}</span>
      {toast.action ? (
        <button type="button" className="toast__action" onClick={(e) => void runAction(e)}>
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        className="toast__close"
        aria-label={t('toasts.close')}
        title={t('toasts.close')}
        onClick={(e) => void close(e)}
      >
        <X size={16} aria-hidden="true" focusable="false" />
      </button>
    </li>
  );
}
