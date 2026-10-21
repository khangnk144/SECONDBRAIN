import { api } from '../api';
import type { ResourcesResponse } from './resources-types';

/** Every file under `3 Resources/` and `Attachments/` with the notes that link to it. */
export function getResources(): Promise<ResourcesResponse> {
  return api().get<ResourcesResponse>('/resources');
}
