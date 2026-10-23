import type { TFunction } from 'i18next';
import type { GraphModelNode } from './graph-model';

/** The folder a node sits in, as the side panel writes it. */
export function graphFolderLabel(t: TFunction, node: Pick<GraphModelNode, 'folder'>): string {
  return node.folder || t('graph.panel.rootFolder');
}

/**
 * Accessible name of a node listed with its folder: "Giải tích 1, trong 2 Areas". The title and
 * folder are separate lines on screen; read together without a separator they would run into one
 * ("Giải tích 1 2 Areas" sounds like "Giải tích 12 Areas").
 */
export function graphNodeNameWithFolder(
  t: TFunction,
  node: Pick<GraphModelNode, 'title' | 'folder'>,
): string {
  return t('graph.panel.nodeInFolder', { title: node.title, folder: graphFolderLabel(t, node) });
}

/** The same name for a node edited in the last 24 h: "…, sửa trong 24 giờ" (F24.3). */
export function graphNodeListName(
  t: TFunction,
  node: Pick<GraphModelNode, 'title' | 'folder'>,
  recent: boolean,
): string {
  const name = graphNodeNameWithFolder(t, node);
  return recent ? t('graph.panel.nodeRecent', { name }) : name;
}
