/**
 * Everything a client can observe from an index, for "these two indexes agree" assertions:
 * notes, links both ways, tags, tasks, the link catalog and a set of searches with snippets.
 */
import type { IndexService } from '../../../src/index/index-types.js';

export const STATE_QUERIES = ['dich', 'ten', 'moi', 'ma tran', 'dinh thuc', 'ban', 'xem', ''];

export function indexState(index: IndexService) {
  const notes = index.listNotes();
  const catalog = index.linkCatalog();
  return {
    notes,
    outlinks: Object.fromEntries(notes.map((n) => [n.path, index.outlinks(n.path)])),
    backlinks: Object.fromEntries(notes.map((n) => [n.path, index.backlinks(n.path)])),
    tags: index.tags(),
    tasks: index.allTasks(),
    catalog: [...catalog.notePaths, ...catalog.filePaths].sort(),
    search: Object.fromEntries(STATE_QUERIES.map((q) => [q, index.search({ q })])),
  };
}
