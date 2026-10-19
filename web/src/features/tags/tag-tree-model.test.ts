import { describe, expect, it } from 'vitest';
import type { TagCount } from '../../lib/api/search-types';
import { buildTagTree, type TagNode } from './tag-tree-model';

const tag = (display: string, count: number, norm = display.normalize('NFC')): TagCount => ({
  tag: display,
  norm,
  count,
});

const shape = (nodes: TagNode[]): unknown[] =>
  nodes.map((n) => [n.segment, n.count, ...(n.children.length ? [shape(n.children)] : [])]);

describe('tag tree (F6.2)', () => {
  it('nests tags by "/" and keeps the counts the server returns', () => {
    const tree = buildTagTree([
      tag('môn/giải-tích', 3),
      tag('môn', 1),
      tag('môn/đại-số', 2),
      tag('đồ-án', 4),
    ]);
    expect(shape(tree)).toEqual([
      ['đồ-án', 4],
      [
        'môn',
        1,
        [
          ['đại-số', 2],
          ['giải-tích', 3],
        ],
      ],
    ]);
    expect(tree[1]?.children[1]?.tag).toBe('môn/giải-tích');
  });

  it('creates a group without count for a parent nobody tagged directly', () => {
    const tree = buildTagTree([tag('dự-án/web/frontend', 2), tag('dự-án/web', 1)]);
    expect(shape(tree)).toEqual([['dự-án', null, [['web', 1, [['frontend', 2]]]]]]);
    expect(tree[0]?.children[0]?.children[0]?.key).toBe('dự-án/web/frontend');
  });

  it('sorts siblings the Vietnamese way (đ after d, accents after the plain letter)', () => {
    const tree = buildTagTree([
      tag('đọc', 1),
      tag('ôn-tập', 1),
      tag('dự-án', 1),
      tag('an', 1),
      tag('Bài-2', 1),
      tag('bài-10', 1),
    ]);
    expect(tree.map((n) => n.segment)).toEqual(['an', 'Bài-2', 'bài-10', 'dự-án', 'đọc', 'ôn-tập']);
  });

  it('groups by the normalized form and shows the first spelling', () => {
    const nfd = 'Môn/giải-tích'.normalize('NFD');
    const tree = buildTagTree([tag(nfd, 2, 'Môn/giải-tích'.normalize('NFC')), tag('Môn', 1)]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.count).toBe(1);
    expect(tree[0]?.children[0]?.count).toBe(2);
  });
});
