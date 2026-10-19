/**
 * Class ids for nodes: two nodes get the same id exactly when they are equal under `eq()`. Nodes
 * are grouped by a cheap content key first, so `eq()` only runs against the few representatives
 * sharing that key, and a node object seen before (one the editor kept) is never compared again.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export class NodeClasses {
  private readonly ids = new Map<ProseMirrorNode, number>();
  private readonly groups = new Map<string, number[]>();
  private readonly representatives: ProseMirrorNode[] = [];

  idOf(node: ProseMirrorNode): number {
    const known = this.ids.get(node);
    if (known !== undefined) return known;
    const key = `${node.type.name}|${node.nodeSize}|${JSON.stringify(node.attrs)}|${node.textContent}`;
    let group = this.groups.get(key);
    if (!group) {
      group = [];
      this.groups.set(key, group);
    }
    let id = group.find((candidate) => this.representatives[candidate]!.eq(node));
    if (id === undefined) {
      id = this.representatives.length;
      this.representatives.push(node);
      group.push(id);
    }
    this.ids.set(node, id);
    return id;
  }

  idsOf(nodes: readonly ProseMirrorNode[], from: number, to: number): Int32Array {
    const ids = new Int32Array(to - from);
    for (let i = from; i < to; i += 1) ids[i - from] = this.idOf(nodes[i]!);
    return ids;
  }
}
