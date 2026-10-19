import { describe, expect, it } from 'vitest';
import { addDays } from '../../src/lib/local-date.js';
import { classifyPath } from '../../src/markdown/content-classes.js';
import { buildSampleDataSet } from '../../src/sample-data/sample-data-set.js';
import { inspectPdf } from './pdf-structure.js';

const TODAY = '2026-10-18';
const set = buildSampleDataSet(TODAY);
const byPath = new Map(set.map((file) => [file.path, file]));
const text = (path: string) => {
  const content = byPath.get(path)?.content;
  expect(typeof content, path).toBe('string');
  return content as string;
};

describe('sample data set content', () => {
  it('has the files SPEC §10 lists, all NFC, unique and valid vault paths', () => {
    const paths = set.map((file) => file.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path).toBe(path.normalize('NFC'));
    for (const path of [
      '2 Areas/Giải tích 1.md',
      '2 Areas/Xác suất thống kê.md',
      '1 Projects/Đồ án Giải tích.md',
      '1 Projects/Research – Tìm research gap.md',
      'wiki/index.md',
      'wiki/log.md',
      'wiki/research-gaps/tim-research-gap.md',
      `Daily/${TODAY}.md`,
      `Daily/${addDays(TODAY, -1)}.md`,
      `Daily/${addDays(TODAY, -2)}.md`,
    ]) {
      expect(byPath.has(path), path).toBe(true);
    }
    const count = (prefix: string) => paths.filter((path) => path.startsWith(prefix)).length;
    expect(count('3 Resources/papers/')).toBe(3);
    expect(count('wiki/papers/')).toBe(3);
    expect(count('wiki/concepts/')).toBe(2);
    expect(count('0 Inbox/')).toBe(2);
  });

  it('gives the project a deadline in 12 days and 5 tasks, 3 done, due today+1 and today+5', () => {
    const project = text('1 Projects/Đồ án Giải tích.md');
    expect(project).toContain(`deadline: ${addDays(TODAY, 12)}`);
    expect(project).toContain('status: doing');
    expect(project.match(/^- \[x\] /gm)).toHaveLength(3);
    expect(project.match(/^- \[ \] /gm)).toHaveLength(2);
    expect(project).toContain(`📅 ${addDays(TODAY, 1)}`);
    expect(project).toContain(`📅 ${addDays(TODAY, 5)}`);
  });

  it('has a Daily task due today and an overdue one, and an ambiguous [[Ghi chú]] link', () => {
    expect(text(`Daily/${TODAY}.md`)).toContain(`- [ ] Nộp bài tập Xác suất thống kê 📅 ${TODAY}`);
    expect(text(`Daily/${addDays(TODAY, -1)}.md`)).toMatch(
      new RegExp(`- \\[ \\] .* 📅 ${addDays(TODAY, -1)}`),
    );
    expect(byPath.has('1 Projects/Ghi chú.md') && byPath.has('2 Areas/Ghi chú.md')).toBe(true);
    expect(text(`Daily/${addDays(TODAY, -2)}.md`)).toContain('[[Ghi chú]]');
  });

  it('links the research project to its three paper pages and the research-gap page', () => {
    const research = text('1 Projects/Research – Tìm research gap.md');
    for (const file of set.filter((f) => f.path.startsWith('wiki/papers/'))) {
      const slug = file.path.slice('wiki/papers/'.length, -'.md'.length);
      expect(research).toContain(`[[${slug}]]`);
    }
    expect(research).toContain('[[wiki/research-gaps/tim-research-gap]]');
  });

  it('writes paper pages with provenance fields matching their generated PDFs', async () => {
    const { createHash } = await import('node:crypto');
    for (const page of set.filter((file) => file.path.startsWith('wiki/papers/'))) {
      const content = page.content as string;
      const source = /^source: (.+)$/m.exec(content)?.[1] ?? '';
      const pdf = byPath.get(source)?.content;
      expect(pdf, source).toBeInstanceOf(Uint8Array);
      inspectPdf(pdf as Uint8Array);
      const hash = createHash('sha256')
        .update(pdf as Uint8Array)
        .digest('hex');
      expect(content).toContain(`source_hash: ${hash}`);
      for (const field of ['pages_covered: 1', 'verified: false', 'ingested_at: ']) {
        expect(content).toContain(field);
      }
      for (const section of [
        '## Tóm tắt',
        '## Phương pháp',
        '## Kết quả (theo tác giả)',
        '## Nhận xét của AI',
      ]) {
        expect(content).toContain(section);
      }
    }
  });

  it('places every file in the class its folder implies (no templates or control docs besides wiki/)', () => {
    const classes = new Set(set.map((file) => classifyPath(file.path)));
    expect(classes).toEqual(new Set(['user', 'wiki', 'control', 'source']));
  });
});
