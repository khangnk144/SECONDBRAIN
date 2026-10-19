import { describe, expect, it } from 'vitest';
import { lineContext } from '../../src/markdown/line-context.js';
import { buildLinkCatalog } from '../../src/markdown/link-catalog.js';
import { findTitleMentions } from '../../src/markdown/title-mentions.js';
import { planLinkMention } from '../../src/mentions/link-mention.js';
import { applyTextPatches } from '../../src/vault/text-range-patches.js';
import { isVaultError } from '../../src/vault/vault-types.js';

const TITLE = 'Giải tích 1';
const texts = (content: string, title = TITLE) =>
  findTitleMentions(content, title).map(({ start, end }) => content.slice(start, end));

describe('unlinked mentions of a title (F5)', () => {
  it('finds plain mentions case-insensitively, whole words only', () => {
    const content =
      'Học giải tích 1 hôm nay. GIẢI TÍCH 1! Không: Giải tích 10, xGiải tích 1, Giải tích 1x.\n';
    expect(texts(content)).toEqual(['giải tích 1', 'GIẢI TÍCH 1']);
  });

  it('skips code, HTML, wikilinks, embeds, Markdown links, URLs and front matter', () => {
    const content = [
      '---',
      'course: Giải tích 1',
      '---',
      'Giải tích 1 ở đây.',
      '`Giải tích 1` và <b>nội dung</b>',
      '<div>',
      'Giải tích 1 trong khối HTML',
      '</div>',
      '',
      '[[Giải tích 1]] ![[Giải tích 1]] [[Khác|Giải tích 1]] [Giải tích 1](a.md)',
      '```',
      'Giải tích 1',
      '```',
      '<https://x.vn/Giải tích 1> https://x.vn/Giải#Giải tích 1 thư@giải.vn',
      '',
      '    Giải tích 1 (indented code)',
      '',
      'Cuối: Giải tích 1',
    ].join('\n');
    const found = findTitleMentions(content, TITLE);
    expect(found.map(({ start, end }) => content.slice(start, end))).toEqual([
      'Giải tích 1',
      'Giải tích 1',
    ]);
    expect(content.slice(0, found[0]!.start)).toBe('---\ncourse: Giải tích 1\n---\n');
    expect(content.slice(found[1]!.end)).toBe('');
  });

  it('matches NFD text with offsets into the NFD content', () => {
    const content = `Ôn ${TITLE.normalize('NFD')} rồi.`;
    const [mention] = findTitleMentions(content, TITLE);
    expect(content.slice(mention!.start, mention!.end)).toBe(TITLE.normalize('NFD'));
    expect(texts(`Tích ${'é'.normalize('NFD')}`, 'Tích e')).toEqual([]);
  });

  it('applies the word rule only where the title starts or ends with a letter or digit', () => {
    expect(texts('C++ và C++x và xC++', 'C++')).toEqual(['C++', 'C++']);
    expect(texts('a#b', '#')).toEqual(['#']);
    expect(texts('anything', '   ')).toEqual([]);
  });
});

describe('context lines keep the highlighted range', () => {
  it('trims a short line and cuts a long one around the range', () => {
    expect(lineContext('  xin [[A]] chào  \nnext', 6, 11)).toEqual({
      context: 'xin [[A]] chào',
      highlight: [4, 9],
    });
    const long = `${'a'.repeat(300)}[[Target]]${'b'.repeat(300)}`;
    const { context, highlight } = lineContext(long, 300, 310);
    expect(context.length).toBe(160);
    expect(context.slice(highlight[0], highlight[1])).toBe('[[Target]]');
    expect(context.startsWith('…') && context.endsWith('…')).toBe(true);
  });
});

describe('linking one mention (F5.2)', () => {
  const unique = buildLinkCatalog(['2 Areas/Giải tích 1.md', '0 Inbox/Ghi chú.md']);
  const twice = buildLinkCatalog([
    '2 Areas/Giải tích 1.md',
    '4 Archive/Giải tích 1.md',
    '0 Inbox/Ghi chú.md',
  ]);
  const content = 'Ôn giải tích 1, rồi Giải tích 1.\n';
  const plan = (catalog = unique, start = 20, end = 31) =>
    planLinkMention(content, {
      notePath: '0 Inbox/Ghi chú.md',
      start,
      end,
      target: '2 Areas/Giải tích 1.md',
      catalog,
    });

  it('uses the title form, with the original text as alias when the case differs', () => {
    expect(applyTextPatches(content, plan())).toBe('Ôn giải tích 1, rồi [[Giải tích 1]].\n');
    expect(applyTextPatches(content, plan(unique, 3, 14))).toBe(
      'Ôn [[Giải tích 1|giải tích 1]], rồi Giải tích 1.\n',
    );
  });

  it('uses the path form when the title is not unique', () => {
    expect(applyTextPatches(content, plan(twice))).toBe(
      'Ôn giải tích 1, rồi [[2 Areas/Giải tích 1|Giải tích 1]].\n',
    );
  });

  it('refuses a range that is not a mention', () => {
    const reason = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return isVaultError(error) ? error.details?.reason : error;
      }
      return 'accepted';
    };
    expect(reason(() => plan(unique, 19, 31))).toBe('not-a-mention');
    expect(reason(() => plan(unique, 0, 5))).toBe('not-a-mention');
  });
});
