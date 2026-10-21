import { useTranslation } from 'react-i18next';
import type { ResourceText } from '../../lib/api/resources-types';

/** Reasons with their own hint, per quality (other reasons show the state alone). */
const HINTS: Record<'low' | 'none', readonly string[]> = {
  low: ['sparse-text', 'too-large'],
  none: ['no-text', 'encrypted', 'damaged', 'too-large', 'timeout'],
};

/**
 * What the app could read of a source file (SPEC F30.2), shown only when it is not the quiet
 * normal case: "Đang đọc chữ…", "Đọc được một phần chữ" or "Không đọc được chữ", with a hint by
 * reason (a scan, a password, a damaged or too large file).
 */
export function ResourceTextState({ text }: { text: ResourceText | null | undefined }) {
  const { t } = useTranslation();
  if (!text || text.quality === 'ok') return null;
  const { quality, reason } = text;
  const hint =
    quality !== 'pending' && reason !== null && HINTS[quality].includes(reason)
      ? t(`resources.text.hints.${quality}.${reason}`)
      : null;
  return (
    <div className={`resource-row__text resource-row__text--${quality}`}>
      <p className="resource-row__text-state">{t(`resources.text.${quality}`)}</p>
      {hint ? <p className="resource-row__text-hint">{hint}</p> : null}
    </div>
  );
}
