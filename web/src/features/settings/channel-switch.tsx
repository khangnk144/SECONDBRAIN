import type { ReactNode } from 'react';
import type { SettingsPatch } from '../../lib/api/settings-types';
import { useChannelSettingSave, type ChannelArea } from './channel-setting-save';
import { SaveStatus } from './save-status';

/**
 * The on/off switch of a backup or reminder channel: a real checkbox announced as a switch. It
 * can only be turned on once the fields it needs are set (`ready`); `missing` says which. It can
 * always be turned off.
 */
export function ChannelSwitch({
  id,
  area,
  label,
  checked,
  ready,
  missing,
  hint,
  toPatch,
  onSaved,
}: {
  id: string;
  area: ChannelArea;
  label: string;
  checked: boolean;
  ready: boolean;
  /** Shown while it cannot be turned on. */
  missing: string;
  hint?: ReactNode;
  toPatch: (enabled: boolean) => SettingsPatch;
  onSaved?: () => void;
}) {
  const { state, save } = useChannelSettingSave(area);
  const blocked = !checked && !ready;
  const hintId = `${id}-hint`;
  return (
    <div className="settings-field">
      <div className="settings-field__control">
        <label className="settings-switch">
          <input
            id={id}
            type="checkbox"
            role="switch"
            checked={checked}
            disabled={blocked}
            aria-describedby={hintId}
            onChange={(event) => {
              if (state.kind === 'saving') return;
              void save(toPatch(event.target.checked)).then((saved) => saved && onSaved?.());
            }}
          />
          <span>{label}</span>
        </label>
        <SaveStatus state={state} />
      </div>
      <div id={hintId} className="settings-field__hint">
        {blocked ? <span>{missing}</span> : null}
        {hint}
      </div>
    </div>
  );
}
