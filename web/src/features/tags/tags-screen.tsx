import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { buildTagTree } from './tag-tree-model';
import { TagTreeItem } from './tag-tree-item';
import { useTags } from './use-tags';
import './tags-screen.css';

const TITLE_ID = 'tags-title';

/** "Thẻ" (`#/tags`): every tag with its note count, nested by `/` (SPEC F6). */
export function TagsScreen() {
  const { t } = useTranslation();
  const { state, retry } = useTags();
  const tree = useMemo(() => (state.status === 'ready' ? buildTagTree(state.tags) : []), [state]);

  return (
    <section className="tags-screen" aria-labelledby={TITLE_ID}>
      <h1 id={TITLE_ID} className="text-display">
        {t('tags.title')}
      </h1>
      {state.status === 'loading' ? <p className="tags-screen__note">{t('tags.loading')}</p> : null}
      {state.status === 'error' ? (
        <div className="tags-screen__note">
          <p role="alert">{t('tags.loadError')}</p>
          <button type="button" className="button button--secondary" onClick={retry}>
            {t('tags.retry')}
          </button>
        </div>
      ) : null}
      {state.status === 'ready' && tree.length === 0 ? (
        <p className="tags-screen__note">{t('tags.empty')}</p>
      ) : null}
      {tree.length > 0 ? (
        <>
          <p className="tags-screen__note">{t('tags.intro')}</p>
          <ul className="tag-tree" aria-label={t('tags.listLabel')}>
            {tree.map((node) => (
              <TagTreeItem key={node.key} node={node} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
