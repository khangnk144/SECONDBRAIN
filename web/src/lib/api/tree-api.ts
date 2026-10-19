import { api } from '../api';
import type { TemplatesResponse, VaultTree } from './tree-types';

/** Sidebar tree, read from disk on every call (never behind the files). */
export function getTree(): Promise<VaultTree> {
  return api().get<VaultTree>('/tree');
}

export function getTemplates(): Promise<TemplatesResponse> {
  return api().get<TemplatesResponse>('/templates');
}
