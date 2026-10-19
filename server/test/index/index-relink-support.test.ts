import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIndexedVault, type IndexedVault } from './helpers/index-test-vault.js';

let v: IndexedVault;
beforeEach(async () => {
  v = await createIndexedVault({
    files: {
      '0 Inbox/Foo.md': 'foo\n',
      '2 Areas/Bar.md': 'bar\n',
      '0 Inbox/Ghi chú.md': 'Xem [[Bar]] và [[Foo]].\n',
      '1 Projects/P.md': 'Theo [[2 Areas/Bar]] rồi [[Bar|ba]].\n',
      '1 Projects/Ghost.md': 'Sẽ có [[Baz]].\n',
      '1 Projects/A/Bài 1.md': 'a\n',
      '1 Projects/B/Bài 1.md': 'b\n',
      '2 Areas/Mơ hồ.md': 'Xem [[Bài 1]].\n',
      '0 Inbox/Không liên quan.md': 'Không có liên kết.\n',
    },
  });
});
afterEach(() => v.cleanup());

describe('notes linking by title or path (relink candidates)', () => {
  it('finds notes linking to a NEW name already used by another note', () => {
    // Renaming Foo to "Bar" must see the notes that use [[Bar]] for 2 Areas/Bar.md today.
    expect(v.index.notesLinkingByTitleOrPath(['0 Inbox/Bar.md'])).toEqual(
      expect.arrayContaining(['0 Inbox/Ghi chú.md', '1 Projects/P.md']),
    );
    expect(v.index.notesLinkingByTitleOrPath(['0 Inbox/Bar.md'])).not.toContain(
      '0 Inbox/Không liên quan.md',
    );
  });

  it('includes ghost and ambiguous links, and several paths at once', () => {
    expect(v.index.notesLinkingByTitleOrPath(['1 Projects/Baz.md'])).toEqual([
      '1 Projects/Ghost.md',
    ]);
    expect(v.index.notesLinkingByTitleOrPath(['1 Projects/A/Bài 1.md'])).toEqual([
      '2 Areas/Mơ hồ.md',
    ]);
    expect(
      v.index.notesLinkingByTitleOrPath(['0 Inbox/Foo.md', '1 Projects/Baz.md']).sort(),
    ).toEqual(['0 Inbox/Ghi chú.md', '1 Projects/Ghost.md']);
    expect(v.index.notesLinkingByTitleOrPath([])).toEqual([]);
  });
});

describe('waiting for queued index updates', () => {
  it('settled() resolves after every update queued so far, including ones queued meanwhile', async () => {
    v.writeFile('0 Inbox/Mới 1.md', 'một [[Mới 2]]\n');
    void v.index.updateFile('0 Inbox/Mới 1.md');
    const settled = v.index.settled();
    v.writeFile('0 Inbox/Mới 2.md', 'hai\n');
    void v.index.updateFile('0 Inbox/Mới 2.md');
    await settled;
    expect(v.index.outlinks('0 Inbox/Mới 1.md')[0]?.toPath).toBe('0 Inbox/Mới 2.md');
    await expect(v.index.settled()).resolves.toBeUndefined();
  });

  it('settled() also waits for a running rebuild and the changes behind it', async () => {
    const rebuild = v.index.rebuild();
    v.writeFile('0 Inbox/Sau.md', 'sau [[Foo]]\n');
    void v.index.updateFile('0 Inbox/Sau.md');
    await v.index.settled();
    expect(v.index.isRebuilding()).toBe(false);
    expect(v.index.outlinks('0 Inbox/Sau.md')[0]?.toPath).toBe('0 Inbox/Foo.md');
    await rebuild;
  });
});
