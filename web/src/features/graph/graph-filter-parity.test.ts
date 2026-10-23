import { describe, expect, it } from 'vitest';
import * as server from '../../../../server/src/graph/graph-filter';
import { FILTER_NODES, NOW, DAY, nfd } from '../../../../server/test/graph/graph-filter-fixture';
import * as web from './graph-filter';

// The map dims exactly what `GET /api/graph?folder=&tag=&since=` would name (SPEC F24.2).
const FILTERS: server.GraphFilter[] = [
  server.EMPTY_GRAPH_FILTER,
  { folders: ['1 projects'], groups: [], tag: null, since: null },
  { folders: [nfd('Daily'), '0 INBOX'], groups: ['areas'], tag: null, since: null },
  { folders: [], groups: ['other', 'resources'], tag: null, since: null },
  { folders: [], groups: [], tag: nfd('#ĐỒ-ÁN'), since: null },
  { folders: [], groups: [], tag: 'Môn', since: null },
  { folders: [], groups: [], tag: 'mo', since: null },
  { folders: [], groups: [], tag: null, since: NOW - DAY },
  { folders: [], groups: [], tag: null, since: NOW - 30 * DAY },
  { folders: [], groups: ['other'], tag: 'đồ-án', since: NOW - DAY },
];

describe('graph filter: web mirror = server predicate (F24.2)', () => {
  it.each(FILTERS.map((filter, i) => [i, filter] as const))(
    '(F24.2) filter %i matches the same nodes on both sides',
    (_i, filter) => {
      expect(web.graphFilterMatches(filter, FILTER_NODES)).toEqual(
        server.graphFilterMatches(filter, FILTER_NODES),
      );
      expect(web.isGraphFilterActive(filter)).toBe(server.isGraphFilterActive(filter));
    },
  );

  it('(F24.2) the same tag normalization and touched time', () => {
    for (const tag of ['#Đồ-Án', nfd('#Đồ-Án'), ' môn/Giải-tích ', 'ĐĐ']) {
      expect(web.normalizeGraphTag(tag)).toBe(server.normalizeGraphTag(tag));
    }
    for (const node of FILTER_NODES) expect(web.touchedAt(node)).toBe(server.touchedAt(node));
  });
});
