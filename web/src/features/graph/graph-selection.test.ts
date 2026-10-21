import { describe, expect, it } from 'vitest';
import { graphRoute, nextSelection } from './graph-selection';

describe('graph selection rule (F16.3)', () => {
  it('a first click selects depth 1, a second click on the same node depth 2', () => {
    const first = nextSelection(null, 'a.md');
    expect(first).toEqual({ id: 'a.md', depth: 1 });
    expect(nextSelection(first, 'a.md')).toEqual({ id: 'a.md', depth: 2 });
    expect(nextSelection({ id: 'a.md', depth: 2 }, 'a.md')).toEqual({ id: 'a.md', depth: 2 });
    expect(nextSelection({ id: 'a.md', depth: 2 }, 'b.md')).toEqual({ id: 'b.md', depth: 1 });
  });

  it('builds /graph?focus= with the path encoded', () => {
    expect(graphRoute('2 Areas/Giải tích 1.md')).toBe(
      `/graph?focus=${encodeURIComponent('2 Areas/Giải tích 1.md')}`,
    );
    expect(graphRoute()).toBe('/graph');
  });
});
