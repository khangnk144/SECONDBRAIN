import { describe, expect, it } from 'vitest';
import {
  graphFilterMask,
  NO_GRAPH_FILTER,
  parseStoredGraphFilter,
  parseWhenParam,
  windowStart,
} from './graph-filter-state';
import { buildGraphModel } from './graph-model';
import { graphNode, graphResponse } from './__tests__/graph-test-helpers';

const TODAY = '2026-10-22';
const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

describe('graph filter state (F24.2)', () => {
  it('(F24.2) time windows start at local midnight: today, 7 and 30 calendar days', () => {
    expect(windowStart('all', TODAY)).toBeNull();
    expect(windowStart('today', TODAY)).toBe(at(2026, 10, 22));
    expect(windowStart('7d', TODAY)).toBe(at(2026, 10, 16));
    expect(windowStart('30d', TODAY)).toBe(at(2026, 9, 23));
  });

  it('(F24.2) ?when= accepts only today, 7d and 30d', () => {
    expect(['today', '7d', '30d', 'all', '1y', null].map(parseWhenParam)).toEqual([
      'today',
      '7d',
      '30d',
      null,
      null,
      null,
    ]);
  });

  it('(F24.2) a remembered filter is checked field by field', () => {
    expect(parseStoredGraphFilter(null)).toEqual(NO_GRAPH_FILTER);
    expect(parseStoredGraphFilter('x')).toEqual(NO_GRAPH_FILTER);
    expect(
      parseStoredGraphFilter({ groups: ['daily', 'planets', 'areas'], tag: 'dồ-án', time: '7d' }),
    ).toEqual({ groups: ['areas', 'daily'], tag: 'dồ-án', time: '7d' });
    expect(parseStoredGraphFilter({ groups: 'daily', tag: ' ', time: 'forever' })).toEqual(
      NO_GRAPH_FILTER,
    );
  });

  it('(F24.2) the mask marks matching nodes of the model; no filter → null', () => {
    const model = buildGraphModel(
      graphResponse(
        [
          graphNode('Daily/2026-10-22.md', { mtimeMs: at(2026, 10, 22, 9) }),
          graphNode('1 Projects/Đồ án.md', { mtimeMs: at(2026, 10, 10), tags: ['dồ-án'] }),
          graphNode('0 Inbox/Mới chép vào.md', {
            mtimeMs: at(2025, 1, 1),
            createdMs: at(2026, 10, 22, 8),
          }),
          graphNode('3 Resources/a.pdf', { kind: 'source', class: 'attachment' }),
        ],
        [],
      ),
    );
    expect(graphFilterMask(model, NO_GRAPH_FILTER, TODAY)).toBeNull();
    const today = graphFilterMask(model, { ...NO_GRAPH_FILTER, time: 'today' }, TODAY);
    expect(today && [...today.match]).toEqual([1, 0, 1, 0]);
    expect(today?.count).toBe(2);
    const tagged = graphFilterMask(model, { ...NO_GRAPH_FILTER, tag: 'dồ-án' }, TODAY);
    expect(tagged && [...tagged.match]).toEqual([0, 1, 0, 0]);
    const groups = graphFilterMask(model, { ...NO_GRAPH_FILTER, groups: ['resources'] }, TODAY);
    expect(groups && [...groups.match]).toEqual([0, 0, 0, 1]);
  });
});
