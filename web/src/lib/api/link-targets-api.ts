import { api } from '../api';
import type { LinkTargetsResponse } from './link-targets-types';

export function getLinkTargets(): Promise<LinkTargetsResponse> {
  return api().get<LinkTargetsResponse>('/link-targets');
}
