import { api } from '../api';
import type { GraphResponse, LocalGraphDepth } from './graph-types';
import { withQuery } from './query-string';
import type { VaultPath } from './vault-types';

/** Every graph node and edge of the vault (brain map). */
export function getGraph(): Promise<GraphResponse> {
  return api().get<GraphResponse>('/graph');
}

/** Nodes within `depth` hops of `path`, the note itself included; 404 NOT_FOUND for an unknown note. */
export function getLocalGraph(path: VaultPath, depth: LocalGraphDepth): Promise<GraphResponse> {
  return api().get<GraphResponse>(withQuery('/graph/local', { path, depth }));
}
