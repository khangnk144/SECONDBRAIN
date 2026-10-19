import { useRef, type FocusEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useToastStore, type Toast } from '../../lib/toast-store';
import { ToastItem } from './toast-item';
import './toasts.css';

function ToastList({
  toasts,
  focusBeforeToasts,
}: {
  toasts: Toast[];
  focusBeforeToasts: () => HTMLElement | null;
}) {
  if (toasts.length === 0) return null;
  return (
    <ul className="toast-host__list">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} focusBeforeToasts={focusBeforeToasts} />
      ))}
    </ul>
  );
}

/**
 * Toasts bottom-right (design.md §5). Two live regions, always present so screen readers pick up
 * changes: errors are announced right away, ordinary confirmations politely. At most three
 * toasts are on screen.
 */
export function ToastHost() {
  const { t } = useTranslation();
  const toasts = useToastStore((state) => state.toasts);
  const outsideFocus = useRef<HTMLElement | null>(null);
  const focusBeforeToasts = () => outsideFocus.current;

  // Remember where keyboard focus came from, so closing a toast can send it back there.
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && !event.currentTarget.contains(from)) {
      outsideFocus.current = from;
    }
  };

  return (
    <section className="toast-host" aria-label={t('toasts.region')} onFocus={onFocus}>
      <div role="status" aria-live="polite">
        <ToastList
          toasts={toasts.filter((toast) => toast.tone !== 'error')}
          focusBeforeToasts={focusBeforeToasts}
        />
      </div>
      <div role="alert" aria-live="assertive">
        <ToastList
          toasts={toasts.filter((toast) => toast.tone === 'error')}
          focusBeforeToasts={focusBeforeToasts}
        />
      </div>
    </section>
  );
}
