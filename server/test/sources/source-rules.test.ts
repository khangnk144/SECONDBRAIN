import { describe, expect, it } from 'vitest';
import { ExtractionLane, LaneClosedError } from '../../src/sources/extraction-lane.js';
import { isBackgroundSource, sourceFormatOf } from '../../src/sources/source-formats.js';
import {
  judgeQuality,
  normalizeExtractedText,
  sensibleTitle,
  sourceIdForPath,
} from '../../src/sources/source-quality.js';

const page = (chars: number) => 'x'.repeat(chars);

describe('extraction quality (F30.2)', () => {
  it('is none below 20 non-space characters in the whole document', () => {
    expect(judgeQuality([' a b ', page(17)], false)).toEqual({
      quality: 'none',
      reason: 'no-text',
    });
    expect(judgeQuality([], false)).toEqual({ quality: 'none', reason: 'no-text' });
    expect(judgeQuality([page(20)], false)).toEqual({ quality: 'low', reason: 'sparse-text' });
  });

  it('is low when 30 % or more of the pages hold under 40 characters, or the cap was hit', () => {
    const good = page(40);
    expect(judgeQuality([good, good, page(39)], false)).toEqual({
      quality: 'low',
      reason: 'sparse-text',
    });
    expect(judgeQuality([good, good, good, page(5)], false)).toEqual({
      quality: 'ok',
      reason: null,
    });
    expect(judgeQuality([good], true)).toEqual({ quality: 'low', reason: 'too-large' });
  });

  it('normalizes whitespace and composes NFD text', () => {
    expect(normalizeExtractedText(' Giải \ttích \r\n\r\n\r\n  1 '.normalize('NFD'))).toBe(
      'Giải tích\n\n1',
    );
  });
});

describe('titles, ids and formats', () => {
  it('keeps a real title and drops file-like ones', () => {
    expect(sensibleTitle('  Học   sâu cho người mới ')).toBe('Học sâu cho người mới');
    for (const bad of ['Microsoft Word - x.docx', 'untitled', 'bao-cao.docx', 'ab', 12, null])
      expect(sensibleTitle(bad)).toBeNull();
  });

  it('derives a stable source id from the NFC, lower-cased path', () => {
    const id = sourceIdForPath('3 Resources/Giải tích.pdf');
    expect(id).toMatch(/^src_[0-9a-f]{16}$/);
    expect(sourceIdForPath('3 resources/GIẢI TÍCH.pdf'.normalize('NFD'))).toBe(id);
    expect(sourceIdForPath('3 Resources/Giai tich.pdf')).not.toBe(id);
  });

  it('knows the supported formats and what the background extracts', () => {
    expect(['a.PDF', 'b.md', 'c.txt', 'd.html', 'e.HTM', 'f.pptx'].map(sourceFormatOf)).toEqual([
      'pdf',
      'text',
      'text',
      'html',
      'html',
      null,
    ]);
    expect(isBackgroundSource('Attachments/2026-10/x.pdf')).toBe(true);
    expect(isBackgroundSource('3 Resources/x.md')).toBe(true);
    expect(isBackgroundSource('1 Projects/x.md')).toBe(false);
    expect(isBackgroundSource('3 Resources/x.png')).toBe(false);
  });
});

describe('extraction lane', () => {
  it('runs one task at a time, priority first, joining duplicate keys', async () => {
    const lane = new ExtractionLane<string>();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const task = (name: string, wait?: Promise<void>) => async () => {
      order.push(name);
      await wait;
      return name;
    };
    const first = lane.run('a', task('a', gate), false);
    const b = lane.run('b', task('b'), false);
    const c = lane.run('c', task('c'), false);
    const urgent = lane.run('c', task('c again'), true);
    release();
    expect(await Promise.all([first, b, c, urgent])).toEqual(['a', 'b', 'c', 'c']);
    expect(order).toEqual(['a', 'c', 'b']);
    await lane.close();
    await expect(lane.run('d', task('d'), false)).rejects.toBeInstanceOf(LaneClosedError);
  });
});
