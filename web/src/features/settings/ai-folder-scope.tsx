import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTreeStore } from '../../lib/tree-store';
import {
  aiScopeChoices,
  effectiveAiFolders,
  isChosenFolder,
  ROOT_NOTES,
  toggledAiFolders,
} from './ai-scope-folders';
import { SaveStatus } from './save-status';
import { useSettingSave } from './use-setting-save';

/** The boxes on offer and the folders AI reads now, from the vault tree and the stored list. */
export function useAiFolders(stored: string[] | null): { choices: string[]; chosen: string[] } {
  const tree = useTreeStore((state) => state.tree);
  useEffect(() => {
    if (!useTreeStore.getState().tree) void useTreeStore.getState().fetchTree();
  }, []);
  const top = tree?.root.folders.map((folder) => folder.path) ?? [];
  return { choices: aiScopeChoices(top), chosen: effectiveAiFolders(stored, top) };
}

/** A folder as she reads it ('' = the notes at the vault root). */
export function useFolderLabel(): (folder: string) => string {
  const { t } = useTranslation();
  return (folder) => (folder === ROOT_NOTES ? t('settings.ai.foldersRoot') : folder);
}

/** The folders AI may read as checkboxes; a change saves the whole chosen list. */
export function AiFolderScope({ folders }: { folders: string[] | null }) {
  const { t } = useTranslation();
  const { choices, chosen } = useAiFolders(folders);
  const label = useFolderLabel();
  const { state, save } = useSettingSave();
  // Boxes stay enabled while saving (a disabled box drops the keyboard focus); a click meanwhile
  // is ignored instead, so two lists built from the same old state never race.
  const toggle = (folder: string, on: boolean) => {
    if (state.kind !== 'saving')
      void save({ ai: { folders: toggledAiFolders(chosen, choices, folder, on) } });
  };
  // Only the root entry means the vault has no folders to choose from.
  const empty = choices.length <= 1;
  return (
    <fieldset className="settings-choices">
      <legend className="settings-field__label">{t('settings.ai.folders')}</legend>
      <p className="settings-field__hint">{t('settings.ai.foldersHint')}</p>
      {empty ? (
        <p className="settings-field__hint">{t('settings.ai.foldersEmpty')}</p>
      ) : (
        <ul className="settings-checklist">
          {choices.map((folder) => (
            <li key={folder === ROOT_NOTES ? '/' : folder}>
              <label className="settings-choice">
                <input
                  type="checkbox"
                  checked={isChosenFolder(chosen, folder)}
                  onChange={(event) => toggle(folder, event.target.checked)}
                />
                <span>{label(folder)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <SaveStatus state={state} />
    </fieldset>
  );
}
