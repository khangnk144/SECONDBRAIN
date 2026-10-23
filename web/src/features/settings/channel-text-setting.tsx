import { useLayoutEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import type { SettingsPatch } from '../../lib/api/settings-types';
import { useChannelSettingSave, type ChannelArea } from './channel-setting-save';
import { SaveStatus } from './save-status';
import { SettingsField } from './settings-section';

/**
 * One text setting of the backup or reminder-channel sections: saved on blur or Enter, Esc puts
 * the stored value back. `parse` turns the trimmed text into the value to save (`''` clears a
 * nullable field) or returns `{ error }` with the sentence to show.
 */
export function ChannelTextSetting({
  id,
  area,
  label,
  value,
  hint,
  placeholder,
  className = 'settings-input--path',
  inputMode,
  autoComplete = 'off',
  parse = (text) => ({ value: text }),
  toPatch,
  onSaved,
}: {
  id: string;
  area: ChannelArea;
  label: string;
  value: string | null;
  hint?: ReactNode;
  placeholder?: string;
  className?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string;
  parse?: (text: string) => { value: string } | { error: string };
  toPatch: (value: string) => SettingsPatch;
  onSaved?: () => void;
}) {
  const { state, save, fail, clear } = useChannelSettingSave(area);
  const stored = value ?? '';
  const [draft, setDraft] = useState(stored);
  useLayoutEffect(() => setDraft(stored), [stored]);
  const statusId = `${id}-status`;

  const commit = () => {
    const text = draft.trim();
    if (text === stored) return;
    const parsed = parse(text);
    if ('error' in parsed) return fail(parsed.error);
    setDraft(parsed.value);
    if (parsed.value === stored) return;
    void save(toPatch(parsed.value)).then((saved) => {
      if (saved) onSaved?.();
    });
  };

  return (
    <SettingsField
      label={label}
      htmlFor={id}
      hint={hint}
      status={<SaveStatus state={state} id={statusId} />}
    >
      <input
        id={id}
        type="text"
        className={`text-input ${className}`}
        value={draft}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        spellCheck={false}
        aria-invalid={state.kind === 'error'}
        aria-describedby={statusId}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            setDraft(stored);
            clear();
          }
        }}
      />
    </SettingsField>
  );
}
