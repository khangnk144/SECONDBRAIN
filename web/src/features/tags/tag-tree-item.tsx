import { useTranslation } from 'react-i18next';
import { useSearchUi } from '../../lib/search-ui-store';
import type { TagNode } from './tag-tree-model';

/** One tag (or tag group) with its nested tags; activating it opens search with `tag:<tag>`. */
export function TagTreeItem({ node }: { node: TagNode }) {
  const { t } = useTranslation();
  const label =
    node.count === null
      ? t('tags.groupLabel', { tag: `#${node.tag}` })
      : t('tags.itemLabel', { tag: `#${node.tag}`, count: node.count });

  return (
    <li className="tag-tree__item">
      <button
        type="button"
        className="tag-tree__button"
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => useSearchUi.getState().openSearch(`tag:${node.tag}`)}
      >
        <span className="tag-pill">#{node.segment}</span>
        {node.count === null ? null : <span className="tag-tree__count">{node.count}</span>}
      </button>
      {node.children.length > 0 ? (
        <ul className="tag-tree tag-tree--nested">
          {node.children.map((child) => (
            <TagTreeItem key={child.key} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
