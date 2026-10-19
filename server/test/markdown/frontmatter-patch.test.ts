import { describe, expect, it } from 'vitest';
import {
  planFrontmatterPatch,
  type FrontmatterEdit,
} from '../../src/markdown/frontmatter-patch.js';
import { formatPropertyValue } from '../../src/markdown/frontmatter-values.js';
import { isVaultError } from '../../src/vault/vault-types.js';
import { applyTextPatches } from '../../src/vault/text-range-patches.js';

const FIXTURE = [
  '---',
  '# Project properties (keep this comment)',
  'type: project   # kind of note',
  "status: 'doing'",
  'deadline: 2026-11-05',
  'course: "[[Giải tích 1]]"',
  'tags:',
  '  - đồ-án',
  '  - "giải tích"',
  '  # about the tags',
  'meta:',
  '  owner: khangnie',
  '  links: [a, b]',
  '',
  'summary: |',
  '  Line one',
  '',
  '  Line two',
  'created: 2026-10-18',
  '---',
  '',
  '# Body',
  'type: not a property',
  '',
].join('\n');

function patched(content: string, edit: FrontmatterEdit): string {
  const patches = planFrontmatterPatch(content, edit);
  return patches.length === 0 ? content : applyTextPatches(content, patches);
}

/** Lines (with their endings) removed and added between two texts that differ in one region. */
function diff(before: string, after: string) {
  const a = before.match(/[^\r\n]*(\r\n|\n|\r|$)/g)!.filter((l) => l !== '');
  const b = after.match(/[^\r\n]*(\r\n|\n|\r|$)/g)!.filter((l) => l !== '');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a.at(-1 - tail) === b.at(-1 - tail)) {
    tail += 1;
  }
  return {
    at: head,
    removed: a.slice(head, a.length - tail),
    added: b.slice(head, b.length - tail),
  };
}

function refusal(content: string, edit: FrontmatterEdit): unknown {
  try {
    planFrontmatterPatch(content, edit);
  } catch (error) {
    if (isVaultError(error)) return { code: error.code, reason: error.details?.reason };
    throw error;
  }
  return 'accepted';
}

describe('front matter text patches: only the edited key changes (F7.1)', () => {
  it('changes one scalar key on its own line, keeping its key spelling and line ending', () => {
    expect(diff(FIXTURE, patched(FIXTURE, { set: { status: 'done' } }))).toEqual({
      at: 3,
      removed: ["status: 'doing'\n"],
      added: ['status: done\n'],
    });
  });

  it('replaces a block list by one flow list and keeps the comment after it', () => {
    expect(
      diff(FIXTURE, patched(FIXTURE, { set: { tags: ['đồ-án', 'giải tích', 'a, b'] } })),
    ).toEqual({
      at: 6,
      removed: ['tags:\n', '  - đồ-án\n', '  - "giải tích"\n'],
      added: ['tags: [đồ-án, giải tích, "a, b"]\n'],
    });
  });

  it('keeps the comment at the end of an edited one-line property', () => {
    expect(diff(FIXTURE, patched(FIXTURE, { set: { type: 'course' } }))).toEqual({
      at: 2,
      removed: ['type: project   # kind of note\n'],
      added: ['type: course   # kind of note\n'],
    });
    const spec = '---\nstatus: doing          # todo | doing | done\ncourse:   # later\n---\n';
    expect(patched(spec, { set: { status: 'done', course: '[[Giải tích 1]]' } })).toBe(
      '---\nstatus: done          # todo | doing | done\ncourse: "[[Giải tích 1]]"   # later\n---\n',
    );
  });

  it('never removes a comment line sitting between two properties', () => {
    const content = '---\nstatus: doing\n  # about the deadline\ndeadline: 2026-11-05\n---\n';
    expect(patched(content, { set: { status: 'done' } })).toBe(
      '---\nstatus: done\n  # about the deadline\ndeadline: 2026-11-05\n---\n',
    );
    expect(patched(content, { unset: ['status'] })).toBe(
      '---\n  # about the deadline\ndeadline: 2026-11-05\n---\n',
    );
  });

  it('adds a new key just before the closing fence', () => {
    expect(diff(FIXTURE, patched(FIXTURE, { set: { priority: 2 } }))).toEqual({
      at: 19,
      removed: [],
      added: ['priority: 2\n'],
    });
  });

  it('removes exactly a nested mapping and exactly a block scalar (blank separators stay)', () => {
    expect(diff(FIXTURE, patched(FIXTURE, { unset: ['meta'] }))).toEqual({
      at: 10,
      removed: ['meta:\n', '  owner: khangnie\n', '  links: [a, b]\n'],
      added: [],
    });
    expect(diff(FIXTURE, patched(FIXTURE, { set: { summary: null } }))).toEqual({
      at: 14,
      removed: ['summary: |\n', '  Line one\n', '\n', '  Line two\n'],
      added: [],
    });
  });

  it('removes the last key without leaving a blank line before the fence', () => {
    const out = patched(FIXTURE, { unset: ['created'] });
    expect(out).toContain('  Line two\n---\n');
    expect(diff(FIXTURE, out).removed).toEqual(['created: 2026-10-18\n']);
  });

  it('keeps CRLF everywhere and writes new lines with CRLF', () => {
    const crlf = FIXTURE.replaceAll('\n', '\r\n');
    const out = patched(crlf, { set: { status: 'done', priority: 1 }, unset: ['meta'] });
    expect(out.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(out).toContain('status: done\r\n');
    expect(out).toContain('created: 2026-10-18\r\npriority: 1\r\n---\r\n');
    expect(out).not.toContain('meta:');
  });

  it('keeps a BOM and a `...` closer; adds the key before the closer', () => {
    const content = '\uFEFF---\ntitle: "x"\n...\nbody\n';
    expect(patched(content, { set: { deadline: '2026-12-01' } })).toBe(
      '\uFEFF---\ntitle: "x"\ndeadline: 2026-12-01\n...\nbody\n',
    );
  });

  it('creates a block at the top (after a BOM, with the file line ending) when there is none', () => {
    expect(
      patched('\uFEFF# Ghi chú\r\nText\r\n', { set: { type: 'note', created: '2026-10-19' } }),
    ).toBe('\uFEFF---\r\ntype: note\r\ncreated: 2026-10-19\r\n---\r\n# Ghi chú\r\nText\r\n');
    expect(planFrontmatterPatch('plain', { unset: ['type'] })).toEqual([]);
    expect(patched('---\n---\nbody', { set: { a: 'b' } })).toBe('---\na: b\n---\nbody');
  });

  it('writes nothing when the value is already there, however it is quoted', () => {
    expect(
      planFrontmatterPatch(FIXTURE, { set: { status: 'doing', deadline: '2026-11-05' } }),
    ).toEqual([]);
    expect(planFrontmatterPatch(FIXTURE, { unset: ['missing'] })).toEqual([]);
  });
});

describe('front matter refusals leave the file alone (F7.2)', () => {
  it('refuses invalid YAML, duplicate keys, non-mapping roots and bad key names', () => {
    expect(refusal('---\na: [1, 2\n---\n', { set: { b: 1 } })).toEqual({
      code: 'VALIDATION',
      reason: 'invalid-yaml',
    });
    expect(refusal('---\na: 1\na: 2\n---\n', { set: { b: 1 } })).toMatchObject({
      reason: 'duplicate-key',
    });
    expect(refusal('---\n- a\n- b\n---\n', { set: { b: 1 } })).toMatchObject({
      reason: 'not-mapping',
    });
    expect(refusal('---\n{a: 1}\n---\n', { set: { b: 1 } })).toMatchObject({
      reason: 'not-mapping',
    });
    for (const key of ['', 'a b', 'a:b', '-x', '#x', 'x'.repeat(101)]) {
      expect(refusal(FIXTURE, { set: { [key]: 1 } })).toMatchObject({ reason: 'invalid-key' });
    }
    expect(refusal(FIXTURE, { set: { a: 1 }, unset: ['a'] })).toMatchObject({
      reason: 'invalid-key',
    });
    expect(refusal(FIXTURE, { set: { a: { nested: 1 } } })).toMatchObject({
      reason: 'unsupported-value',
    });
  });

  it('refuses a patch that would change another key (an alias to the replaced anchor)', () => {
    expect(refusal('---\nbase: &b x\nother: *b\n---\n', { set: { base: 'y' } })).toMatchObject({
      reason: 'patch-verify',
    });
  });
});

describe('property values are written YAML-safely in one style', () => {
  it.each([
    ['2026-11-05', '2026-11-05'],
    ['Giải tích 1', 'Giải tích 1'],
    ['[[Giải tích 1]]', '"[[Giải tích 1]]"'],
    ['true', '"true"'],
    ['123', '"123"'],
    ['', '""'],
    ['a: b', '"a: b"'],
    ['x #y', '"x #y"'],
    [' padded', '" padded"'],
    ['line\nbreak', '"line\\nbreak"'],
    ['say "hi"', 'say "hi"'],
    ['"quoted"', '"\\"quoted\\""'],
    [42, '42'],
    [1.5, '1.5'],
    [false, 'false'],
    [['đồ-án', 'a, b', '[[X]]', 3], '[đồ-án, "a, b", "[[X]]", 3]'],
    [[], '[]'],
  ])('%j → %s', (value, text) => {
    expect(formatPropertyValue('k', value)).toBe(text);
    // Every format reads back as the value through a real patch.
    expect(patched('---\nk: 0\n---\n', { set: { k: value } })).toBe(`---\nk: ${text}\n---\n`);
  });
});
