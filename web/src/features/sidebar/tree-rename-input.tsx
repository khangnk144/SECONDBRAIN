import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cleanName, validateName } from '../../lib/name-validation';
import { nameProblemMessage } from '../../lib/operation-errors';

export interface TreeRenameInputProps {
  initialName: string;
  /** Called once with a valid, changed name. */
  onCommit: (name: string) => void;
  onCancel: () => void;
}

/**
 * Inline rename in the tree: Enter commits, Esc cancels, leaving the field commits a valid change
 * (or cancels). Keys never reach the tree's own keyboard handling.
 */
export function TreeRenameInput({ initialName, onCommit, onCancel }: TreeRenameInputProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [value, setValue] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const finished = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  /** Returns false when the name is invalid (the field stays open). */
  function finish(fromBlur: boolean): boolean {
    if (finished.current) return true;
    const name = cleanName(value);
    if (name === initialName) {
      finished.current = true;
      onCancel();
      return true;
    }
    const problem = validateName(name);
    if (problem) {
      if (fromBlur) {
        finished.current = true;
        onCancel();
        return true;
      }
      setError(nameProblemMessage(problem));
      return false;
    }
    finished.current = true;
    onCommit(name);
    return true;
  }

  return (
    <span className="tree-rename">
      <input
        ref={ref}
        className="tree-rename__input"
        value={value}
        aria-label={t('sidebar-tree.renameLabel')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            finish(false);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            finished.current = true;
            onCancel();
          }
        }}
        onBlur={() => finish(true)}
      />
      {error ? (
        <span id={errorId} className="tree-rename__error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
