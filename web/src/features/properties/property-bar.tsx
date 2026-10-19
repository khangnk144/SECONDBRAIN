import { Plus, Warning } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showToast } from '../../lib/toast-store';
import type { FrontmatterChange } from '../note-session/note-session-types';
import { AddPropertyForm } from './add-property-form';
import { parseFrontmatter, type PropertyEntry } from './frontmatter-values';
import { PropertyChip } from './property-chip';
import { propertyLabel } from './property-format';
import { PropertyPopover } from './property-popover';
import './property-bar.css';

interface PropertyBarProps {
  /** Front matter of the text of record, fences included; null when the note has none. */
  frontmatterRaw: string | null;
  /** Read-only note, conflict open, or source mode. */
  disabled: boolean;
  /** Flushes pending edits, then patches at the new revision; resolves true when it worked. */
  onPatch: (change: FrontmatterChange) => Promise<boolean>;
}

/** A removed value can be put back when it is something a patch can write again. */
const restorable = (entry: PropertyEntry) => entry.value !== null && entry.kind !== 'complex';

/** The soft row of property chips between the title and the body (F7). */
export function PropertyBar({ frontmatterRaw, disabled, onPatch }: PropertyBarProps) {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseFrontmatter(frontmatterRaw), [frontmatterRaw]);
  const [adding, setAdding] = useState(false);
  const addBoundary = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  // After a removal, keyboard focus goes to the next chip, else the previous one, else "Thêm".
  const [focusAfterRemove, setFocusAfterRemove] = useState<{ key: string | null } | null>(null);

  useEffect(() => {
    if (!focusAfterRemove) return;
    const chips = [...(bar.current?.querySelectorAll<HTMLElement>('.property-chip') ?? [])];
    const chip = chips.find((element) => element.dataset.key === focusAfterRemove.key);
    const target = chip?.querySelector<HTMLElement>('.property-chip__main') ?? addButton.current;
    target?.focus();
    setFocusAfterRemove(null);
  }, [focusAfterRemove, frontmatterRaw]);

  if (parsed.status === 'invalid') {
    return (
      <section className="property-bar property-bar--invalid" aria-label={t('properties.label')}>
        <p className="property-bar__warning">
          <Warning size={18} aria-hidden="true" />
          <span>{t('properties.invalidYaml')}</span>
        </p>
        <pre className="property-bar__raw">{parsed.raw}</pre>
      </section>
    );
  }

  const entries = parsed.status === 'ok' ? parsed.entries : [];
  const remove = async (entry: PropertyEntry) => {
    const index = entries.indexOf(entry);
    const next = entries[index + 1] ?? entries[index - 1] ?? null;
    if (!(await onPatch({ unset: [entry.key] }))) return;
    setFocusAfterRemove({ key: next?.key ?? null });
    const label = propertyLabel(t, entry.key);
    showToast({
      message: t('properties.removed', { label }),
      action: restorable(entry)
        ? {
            label: t('properties.undo'),
            run: () => void onPatch({ set: { [entry.key]: entry.value } }),
          }
        : undefined,
    });
  };
  const closeAdd = () => {
    setAdding(false);
    addButton.current?.focus();
  };

  return (
    <div ref={bar} className="property-bar" role="group" aria-label={t('properties.label')}>
      {entries.map((entry) => (
        <PropertyChip
          key={entry.key}
          entry={entry}
          disabled={disabled}
          onCommit={(key, value) => void onPatch({ set: { [key]: value } })}
          onRemove={(target) => void remove(target)}
        />
      ))}
      {disabled ? null : (
        <div ref={addBoundary} className="property-bar__add">
          <button
            ref={addButton}
            type="button"
            className="property-bar__add-button"
            aria-haspopup="dialog"
            aria-expanded={adding}
            onClick={() => setAdding((was) => !was)}
          >
            <Plus size={16} aria-hidden="true" />
            <span>{t('properties.addProperty')}</span>
          </button>
          {adding ? (
            <PropertyPopover
              label={t('properties.addProperty')}
              boundaryRef={addBoundary}
              onClose={closeAdd}
            >
              <AddPropertyForm
                existingKeys={entries.map((entry) => entry.key)}
                onAdd={(key, value) => {
                  void onPatch({ set: { [key]: value } });
                  closeAdd();
                }}
              />
            </PropertyPopover>
          ) : null}
        </div>
      )}
    </div>
  );
}
