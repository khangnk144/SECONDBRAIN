import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTreeStore } from '../../lib/tree-store';
import { pathKey } from '../../lib/vault-paths';
import { SaveStatus } from './save-status';
import { useSettingSave } from './use-setting-save';

/** Left out of the AI's reading by default (SPEC F18: sources and the archive). */
export const AI_DEFAULT_EXCLUDED = ['3 Resources', '4 Archive'];

/** The folders AI may read: the stored list, or every top folder but the default exclusions. */
export function effectiveAiFolders(stored: string[] | null, topFolders: string[]): string[] {
  if (stored !== null) return stored;
  const excluded = new Set(AI_DEFAULT_EXCLUDED.map(pathKey));
  return topFolders.filter((folder) => !excluded.has(pathKey(folder)));
}

/** The top folders of the vault as checkboxes; a change saves the whole chosen list. */
export function AiFolderScope({ folders }: { folders: string[] | null }) {
  const { t } = useTranslation();
  const tree = useTreeStore((state) => state.tree);
  const { state, save } = useSettingSave();
  useEffect(() => {
    if (!useTreeStore.getState().tree) void useTreeStore.getState().fetchTree();
  }, []);
  const top = tree?.root.folders.map((folder) => folder.path) ?? [];
  const chosen = effectiveAiFolders(folders, top);
  const isChosen = (folder: string) => chosen.some((item) => pathKey(item) === pathKey(folder));
  const toggle = (folder: string, on: boolean) => {
    const next = on
      ? [...chosen, folder]
      : chosen.filter((item) => pathKey(item) !== pathKey(folder));
    // Keep the vault's own order.
    void save({
      ai: { folders: top.filter((item) => next.some((n) => pathKey(n) === pathKey(item))) },
    });
  };
  return (
    <fieldset className="settings-choices">
      <legend className="settings-field__label">{t('settings.ai.folders')}</legend>
      <p className="settings-field__hint">{t('settings.ai.foldersHint')}</p>
      {top.length === 0 ? (
        <p className="settings-field__hint">{t('settings.ai.foldersEmpty')}</p>
      ) : (
        <ul className="settings-checklist">
          {top.map((folder) => (
            <li key={folder}>
              <label className="settings-choice">
                <input
                  type="checkbox"
                  checked={isChosen(folder)}
                  disabled={state.kind === 'saving'}
                  onChange={(event) => toggle(folder, event.target.checked)}
                />
                <span>{folder}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <SaveStatus state={state} />
    </fieldset>
  );
}
