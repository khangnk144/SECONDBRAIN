import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { copyText } from './copy-text';

/** "Đã sao chép" stays this long on the button. */
export const COPIED_NOTICE_MS = 2_000;

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * A read-only configuration snippet with "Sao chép". `shown` is what the screen displays (the
 * HTTP snippet hides its token), `full` is what lands on the clipboard.
 */
export function SnippetBlock({
  label,
  shown,
  full,
  failedText,
}: {
  label: string;
  shown: string;
  full: string;
  failedText: string;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    const copied = await copyText(full);
    if (timer.current) clearTimeout(timer.current);
    setState(copied ? 'copied' : 'failed');
    if (copied) timer.current = setTimeout(() => setState('idle'), COPIED_NOTICE_MS);
  };
  return (
    <div className="settings-field">
      <p id={labelId} className="settings-field__label">
        {label}
      </p>
      {/* Focusable so a keyboard can scroll a long line into view. */}
      <pre className="settings-snippet" tabIndex={0} aria-labelledby={labelId}>
        <code>{shown}</code>
      </pre>
      <div className="settings-field__control">
        <button
          type="button"
          className="button button--secondary"
          aria-describedby={labelId}
          onClick={() => void copy()}
        >
          {state === 'copied' ? t('settings.mcp.copied') : t('settings.mcp.copy')}
        </button>
        <span className="visually-hidden" role="status">
          {state === 'copied' ? t('settings.mcp.copied') : ''}
        </span>
      </div>
      {state === 'failed' ? (
        <p className="settings-status settings-status--error" role="alert">
          {failedText}
        </p>
      ) : null}
    </div>
  );
}
