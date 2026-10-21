import { describe, expect, it } from 'vitest';
import { groupCitations } from './answer-citations';
import { parseInline } from './answer-markdown';

const cite = (text: string) => groupCitations(parseInline(text));

describe('citations in a text answer', () => {
  it('groups a run of links joined by ", " and keeps the sentence around it', () => {
    expect(cite('Bayes [[a|A]], [[b|B]]. Hết.')).toEqual([
      { kind: 'text', text: 'Bayes ' },
      {
        kind: 'cite',
        links: [
          { target: 'a', label: 'A', page: null },
          { target: 'b', label: 'B', page: null },
        ],
      },
      { kind: 'text', text: '. Hết.' },
    ]);
  });

  it('moves a PDF page into its citation, also before a joiner', () => {
    expect(cite('Xem [[bài.pdf]] (tr. 3), [[c|C]]')).toEqual([
      { kind: 'text', text: 'Xem ' },
      {
        kind: 'cite',
        links: [
          { target: 'bài.pdf', label: 'bài.pdf', page: 3 },
          { target: 'c', label: 'C', page: null },
        ],
      },
    ]);
    expect(cite('[[bài.pdf]] (p. 12)')).toEqual([
      { kind: 'cite', links: [{ target: 'bài.pdf', label: 'bài.pdf', page: 12 }] },
    ]);
  });

  it('two citations apart stay two groups; links inside bold are grouped too', () => {
    const out = cite('**Ý chính [[a|A]]** và ý phụ [[b|B]], còn lại');
    expect(out.map((node) => node.kind)).toEqual(['bold', 'text', 'cite', 'text']);
    expect(out[0]).toMatchObject({ children: [{ kind: 'text' }, { kind: 'cite' }] });
    expect(out[3]).toEqual({ kind: 'text', text: ', còn lại' });
  });
});
