import { useId, useLayoutEffect, useReducer, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { focusIsLost, MAIN_REGION_ID } from '../../lib/focus-recovery';
import { showOperationError } from '../../lib/operation-errors';
import { showToast } from '../../lib/toast-store';
import { useTreeStore } from '../../lib/tree-store';
import { useLiveQuery } from '../../lib/use-live-query';
import { vaultStorage } from '../../lib/vault-storage';
import { useVaultStore } from '../../lib/vault-store';
import { getSampleDataStatus, postSampleData } from './sample-data-api';

export const SAMPLE_DATA_DECLINED_KEY = 'today.sampleDataDeclined';

export interface SampleDataPromptProps {
  /** The sample notes exist now: Today reloads. */
  onCreated: () => void;
  /**
   * Where focus goes when the card disappears under it. `byPointer`: the button was clicked with
   * a mouse or pen, so the focus that follows needs no visible ring.
   */
  focusAfter: (byPointer: boolean) => void;
}

/** A click from a pointer (keyboard activation of a button reports `detail` 0). */
const byPointer = (event: MouseEvent) => event.detail > 0;

/**
 * SPEC §10: on the first open of an empty vault, a calm card asks "Tạo dữ liệu mẫu để xem thử?"
 * (Yes is the primary button and takes focus). "Không, cảm ơn" is remembered per vault in this
 * browser. The parent hides the card while the server is unreachable.
 */
export function SampleDataPrompt({ onCreated, focusAfter }: SampleDataPromptProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const status = useLiveQuery('sample-data', getSampleDataStatus);
  useVaultStore((state) => state.vaultId); // the declined flag is per vault
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const yesRef = useRef<HTMLButtonElement>(null);
  const declined = vaultStorage.get<boolean>(SAMPLE_DATA_DECLINED_KEY, false) === true;
  const visible = status.data?.offered === true && !declined && !created;

  // Default focus on Yes, unless the user is already somewhere (typing in the capture box…).
  useLayoutEffect(() => {
    if (!visible) return;
    if (focusIsLost() || document.activeElement?.id === MAIN_REGION_ID) yesRef.current?.focus();
  }, [visible]);

  if (!visible) return null;

  async function accept(pointer: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await postSampleData();
      setCreated(true);
      useTreeStore.getState().scheduleRefresh();
      showToast({ message: t('today.sample.created') });
      onCreated();
      focusAfter(pointer);
    } catch (error) {
      showOperationError(error);
    } finally {
      setBusy(false);
    }
  }

  function decline(pointer: boolean) {
    vaultStorage.set(SAMPLE_DATA_DECLINED_KEY, true);
    rerender();
    focusAfter(pointer);
  }

  return (
    <section className="sample-data-card" aria-labelledby={headingId}>
      <h2 id={headingId} className="sample-data-card__question">
        {t('today.sample.question')}
      </h2>
      <p className="sample-data-card__body">{t('today.sample.body')}</p>
      <div className="sample-data-card__actions">
        <button
          ref={yesRef}
          type="button"
          className="button button--primary"
          aria-disabled={busy}
          onClick={(event) => void accept(byPointer(event))}
        >
          {busy ? t('today.sample.creating') : t('today.sample.create')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={(event) => decline(byPointer(event))}
        >
          {t('today.sample.decline')}
        </button>
      </div>
    </section>
  );
}
