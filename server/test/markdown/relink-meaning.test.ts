/**
 * A rename or move must never change what a link means: after applying the plan, every link
 * that resolved before resolves to the same note (the moved one at its new path), unless the
 * plan reports it as unresolvable; ghosts and ambiguous links are left alone.
 */
import { describe, expect, it } from 'vitest';
import { buildLinkCatalog } from '../../src/markdown/link-catalog.js';
import { parseNote } from '../../src/markdown/parse-note.js';
import { planRelink, type RelinkInput, type RelinkPlan } from '../../src/markdown/relink.js';
import { resolveLink } from '../../src/markdown/resolve-link.js';

type Files = Record<string, string>;
type Op = RelinkInput['op'];

async function plan(files: Files, op: Op): Promise<RelinkPlan> {
  return planRelink({
    op,
    catalog: buildLinkCatalog(Object.keys(files)),
    candidates: Object.keys(files),
    readNote: async (path) => ({ content: files[path] as string, revision: `rev:${path}` }),
  });
}

/** The vault after the operation with the plan's edits applied (keyed by new paths). */
function applied(files: Files, op: Op, result: RelinkPlan): Files {
  const after: Files = {};
  for (const [path, content] of Object.entries(files))
    after[path === op.from ? op.to : path] = content;
  for (const edit of result.edits)
    after[edit.path === op.from ? op.to : edit.path] = edit.newContent;
  return after;
}

/** Asserts the "no link changes meaning" guarantee for every note of the vault. */
function expectMeaningKept(files: Files, op: Op, result: RelinkPlan): Files {
  const before = buildLinkCatalog(Object.keys(files));
  const afterFiles = applied(files, op, result);
  const after = buildLinkCatalog(Object.keys(afterFiles));
  for (const [path, content] of Object.entries(files)) {
    const pathAfter = path === op.from ? op.to : path;
    const oldLinks = parseNote(content).links;
    const newLinks = parseNote(afterFiles[pathAfter] as string).links;
    expect(newLinks).toHaveLength(oldLinks.length);
    oldLinks.forEach((link, i) => {
      const was = resolveLink(before, link, path);
      const now = resolveLink(after, newLinks[i]!, pathAfter);
      if (link.kind === 'markdown' || was.status !== 'resolved') return;
      if (result.unresolvable.some((u) => u.path === path && u.raw === link.raw)) return;
      const intended = was.path === op.from ? op.to : was.path;
      expect(now, `${path}: ${link.raw}`).toEqual({ status: 'resolved', path: intended });
    });
  }
  return afterFiles;
}

describe('relink keeps every link pointing where it pointed (F4.3, F4.4)', () => {
  it('pins third-party links when a note is renamed into an existing title', async () => {
    const files: Files = {
      '0 Inbox/Foo.md': 'foo',
      '2 Areas/Bar.md': 'bar',
      '0 Inbox/Inbox note.md': 'links [[Bar]] and [[Foo]]',
      '1 Projects/P.md': 'links [[Bar]] and [[Bar|alias]]',
    };
    const op: Op = { kind: 'rename', from: '0 Inbox/Foo.md', to: '0 Inbox/Bar.md' };
    const result = await plan(files, op);
    const after = expectMeaningKept(files, op, result);
    expect(after['0 Inbox/Inbox note.md']).toBe('links [[2 Areas/Bar]] and [[Bar]]');
    expect(after['1 Projects/P.md']).toBe('links [[2 Areas/Bar]] and [[2 Areas/Bar|alias]]');
  });

  it("pins the moved note's own links that resolved through its old folder", async () => {
    const files: Files = {
      '1 Projects/A/x.md': 'see [[Bài 1]] and [[Bài 1#Ý]]',
      '1 Projects/A/Bài 1.md': 'a',
      '1 Projects/B/Bài 1.md': 'b',
    };
    const op: Op = { kind: 'move', from: '1 Projects/A/x.md', to: '1 Projects/B/x.md' };
    const after = expectMeaningKept(files, op, await plan(files, op));
    expect(after['1 Projects/B/x.md']).toBe(
      'see [[1 Projects/A/Bài 1]] and [[1 Projects/A/Bài 1#Ý]]',
    );
  });

  it('leaves links that were ambiguous or ghosts untouched', async () => {
    const files: Files = {
      '1 Projects/A/Bài 1.md': 'a',
      '1 Projects/B/Bài 1.md': 'b',
      '2 Areas/x.md': 'see [[Bài 1]] and [[Không có]]',
    };
    const op: Op = {
      kind: 'rename',
      from: '1 Projects/A/Bài 1.md',
      to: '1 Projects/A/Bài 1 (A).md',
    };
    const result = await plan(files, op);
    expect(result.edits).toEqual([]);
    expect(result.unresolvable).toEqual([]);
  });

  it('keeps the guarantee across many renames and moves of a mixed vault', async () => {
    const files: Files = {
      'Bài 1.md': 'gốc [[Bài 2]] [[2 Areas/Bài 1]]',
      '2 Areas/Bài 1.md': 'a [[Bài 1]] [[Bài 2|hai]] ![[Bài 3]] [[Bài 1#H]]',
      '2 Areas/Bài 2.md': 'b [[Bài 1]] [[Bài 3]] `[[Bài 1]]`',
      '2 Areas/Sub/Bài 3.md': '---\ncourse: "[[Bài 1]]"\nrel:\n  - [[Bài 2]]\n---\nc [[Bài 2]]',
      '0 Inbox/Ghi chú.md': '[[Bài 1]] [[Bài 2]] [[Bài 3]] [[2 Areas/Sub/Bài 3|ba]]',
    };
    const ops: Op[] = [
      { kind: 'rename', from: '2 Areas/Bài 1.md', to: '2 Areas/Bài 2 bis.md' },
      { kind: 'rename', from: '2 Areas/Bài 2.md', to: '2 Areas/Bài 1 mới.md' },
      { kind: 'rename', from: '2 Areas/Sub/Bài 3.md', to: '2 Areas/Sub/Bài 1.md' },
      { kind: 'move', from: '2 Areas/Bài 2.md', to: '0 Inbox/Bài 2.md' },
      { kind: 'move', from: 'Bài 1.md', to: '2 Areas/Sub/Bài 1.md' },
      { kind: 'move', from: '0 Inbox/Ghi chú.md', to: '2 Areas/Ghi chú.md' },
    ];
    for (const op of ops) expectMeaningKept(files, op, await plan(files, op));
  });
});

describe('relink writes valid YAML in front matter', () => {
  const vault = (yaml: string): Files => ({
    '0 Inbox/Old.md': 'o',
    '0 Inbox/L.md': `---\n${yaml}\n---\nbody [[Old]]\n`,
  });

  async function renamed(yaml: string, title: string): Promise<ReturnType<typeof parseNote>> {
    const files = vault(yaml);
    const op: Op = { kind: 'rename', from: '0 Inbox/Old.md', to: `0 Inbox/${title}.md` };
    const result = await plan(files, op);
    const after = expectMeaningKept(files, op, result);
    const note = parseNote(after['0 Inbox/L.md'] as string);
    expect(note.frontmatter.error).toBeNull();
    for (const link of note.links) expect(link.target).toBe(title);
    return note;
  }

  it("doubles a quote inside single-quoted values (Bob's notes)", async () => {
    const note = await renamed("course: '[[Old]]'\nrelated:\n  - '[[Old|o]]'", "Bob's notes");
    expect(note.frontmatter.raw).toBe(
      "course: '[[Bob''s notes]]'\nrelated:\n  - '[[Bob''s notes|o]]'",
    );
    expect(note.frontmatter.data).toEqual({
      course: "[[Bob's notes]]",
      related: ["[[Bob's notes|o]]"],
    });
  });

  it('escapes quotes inside double-quoted values', async () => {
    const note = await renamed('course: "[[Old]]"', 'Say "hi"');
    expect(note.frontmatter.data).toEqual({ course: '[[Say "hi"]]' });
  });

  it('quotes a plain value when the new title needs it', async () => {
    const note = await renamed('course: [[Old]]\nlist:\n  - [[Old]]', 'Ch 1: intro');
    expect(note.frontmatter.raw).toBe('course: "[[Ch 1: intro]]"\nlist:\n  - "[[Ch 1: intro]]"');
    expect(note.frontmatter.data).toEqual({ course: '[[Ch 1: intro]]', list: ['[[Ch 1: intro]]'] });
  });
});

describe('relink reports links it cannot write', () => {
  const cases: [string, string[]][] = [
    ['Lập trình C#', ['[[Old|bí danh]]', '[[Old]]']],
    ['A|B', ['[[Old|bí danh]]', '[[Old]]']],
    ['Mã `x', ['[[Old|bí danh]]', '[[Old]]']],
    // `[[Bài [1]|bí danh]]` still parses (the first `]]` follows the alias); `[[Bài [1]]]` not.
    ['Bài [1]', ['[[Old]]']],
  ];
  for (const [title, reported] of cases) {
    it(`leaves unwritable links unchanged and reports them ("${title}")`, async () => {
      const files: Files = {
        '0 Inbox/Old.md': 'o',
        '0 Inbox/L.md': 'xem [[Old]] và [[Old|bí danh]] `c`',
      };
      const op: Op = { kind: 'rename', from: '0 Inbox/Old.md', to: `0 Inbox/${title}.md` };
      const result = await plan(files, op);
      expect(result.unresolvable.map((u) => u.raw)).toEqual(reported);
      for (const u of result.unresolvable)
        expect(u).toMatchObject({ path: '0 Inbox/L.md', line: 1, intended: op.to });
      const after = expectMeaningKept(files, op, result);
      expect(after['0 Inbox/L.md']).toContain('xem [[Old]]');
    });
  }
});
