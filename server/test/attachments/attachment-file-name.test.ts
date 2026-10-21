import { describe, expect, it } from 'vitest';
import { attachmentFileName } from '../../src/attachments/attachment-file-name.js';
import {
  attachmentFolder,
  extensionOf,
  fileKindOf,
} from '../../src/attachments/attachment-kinds.js';
import { segmentProblem } from '../../src/security/path-guard.js';

const NOW = new Date(2026, 9, 21, 9, 5);
const name = (raw: string) => attachmentFileName(raw, NOW);

describe('attachment file names (F15.1)', () => {
  it('keeps an ordinary name exactly, Vietnamese letters and extension case included', () => {
    expect(name('bài giảng 3.pdf')).toBe('bài giảng 3.pdf');
    expect(name('Ảnh chụp.PNG')).toBe('Ảnh chụp.PNG');
    expect(name('report.v2.final.docx')).toBe('report.v2.final.docx');
  });

  it('normalizes an NFD name to NFC', () => {
    const nfd = 'bài giảng 3.pdf'.normalize('NFD');
    expect(nfd).not.toBe('bài giảng 3.pdf');
    expect(name(nfd)).toBe('bài giảng 3.pdf');
  });

  it('turns path separators and Windows-invalid characters into spaces', () => {
    expect(name('..\\x.png')).toBe('x.png');
    expect(name('a/b.pdf')).toBe('a b.pdf');
    expect(name('../../etc/passwd')).toBe('etc passwd');
    expect(name('a:b*c?d"e<f>g|h.txt')).toBe('a b c d e f g h.txt');
    expect(name('C:\\Users\\khang\\Desktop\\đề cương.docx')).toBe(
      'C Users khang Desktop đề cương.docx',
    );
  });

  it('replaces the characters that would cut a wikilink short', () => {
    expect(name('C# [draft] ^1.pdf')).toBe('C draft 1.pdf');
  });

  it('replaces control characters, drops format characters, keeps emoji sequences whole', () => {
    expect(name('a\u0000b\u0007c\nd.png')).toBe('a b c d.png');
    expect(name('\uFEFFtrái\u200B phải\u202E.pdf')).toBe('trái phải.pdf');
    expect(name('Giải\u00ADtích.pdf')).toBe('Giảitích.pdf');
    expect(name('gia đình 👨‍👩‍👧.png')).toBe('gia đình 👨‍👩‍👧.png');
  });

  it('collapses whitespace and trims dots and spaces at both ends', () => {
    expect(name('  bài   tập \t 1  .pdf  ')).toBe('bài tập 1 .pdf');
    expect(name('notes.pdf...')).toBe('notes.pdf');
    expect(name('.sb-0123456789ab.tmp')).toBe('sb-0123456789ab.tmp');
  });

  it('refuses reserved device names and empty names with a dated fallback', () => {
    expect(name('CON.pdf')).toBe('Tệp đính kèm 2026-10-21 09-05.pdf');
    expect(name('nul')).toBe('Tệp đính kèm 2026-10-21 09-05');
    expect(name('com0.txt')).toBe('Tệp đính kèm 2026-10-21 09-05.txt');
    expect(name('lpt¹.png')).toBe('Tệp đính kèm 2026-10-21 09-05.png');
    expect(name('')).toBe('Tệp đính kèm 2026-10-21 09-05');
    expect(name('....')).toBe('Tệp đính kèm 2026-10-21 09-05');
    expect(name('\u200B.png')).toBe('Tệp đính kèm 2026-10-21 09-05.png');
  });

  it('cuts long names to 120 code points on a grapheme boundary, keeping the extension', () => {
    const long = `${'ả'.normalize('NFD').repeat(100)}.pdf`;
    const result = name(long);
    expect(Array.from(result).length).toBeLessThanOrEqual(120);
    expect(result.endsWith('.pdf')).toBe(true);
    expect(result).toBe(`${'ả'.repeat(100)}.pdf`);
    const emoji = `${'😀'.repeat(200)}.png`;
    expect(name(emoji)).toBe(`${'😀'.repeat(116)}.png`);
  });

  it('treats a long or spaced tail as part of the name, not as an extension', () => {
    expect(name('bản nháp.lần cuối')).toBe('bản nháp.lần cuối');
    expect(extensionOf('bản nháp.lần cuối')).toBe('lần cuối');
  });

  it('always yields a name the path guard accepts', () => {
    const inputs = ['a. ', ' .', 'x\u0085y.md', 'aux .txt', '😀', '\uD800.png', 'a'.repeat(400)];
    for (const input of inputs) expect(segmentProblem(name(input)), input).toBeNull();
  });
});

describe('attachment placement and kinds (SPEC §4.8)', () => {
  it('puts images into the local month under Attachments, whatever the target', () => {
    expect(attachmentFolder('image.png', 'papers', NOW)).toBe('Attachments/2026-10');
    expect(attachmentFolder('vẽ.SVG', 'auto', new Date(2026, 10, 1, 0, 0))).toBe(
      'Attachments/2026-11',
    );
  });

  it('puts documents under 3 Resources: auto by extension, or the chosen folder', () => {
    expect(attachmentFolder('bài giảng 3.pdf', 'auto', NOW)).toBe('3 Resources/papers');
    expect(attachmentFolder('slide.pptx', 'auto', NOW)).toBe('3 Resources/slides');
    expect(attachmentFolder('deck.key', 'auto', NOW)).toBe('3 Resources/slides');
    expect(attachmentFolder('đề cương.docx', 'auto', NOW)).toBe('3 Resources/other');
    expect(attachmentFolder('bài giảng 3.pdf', 'slides', NOW)).toBe('3 Resources/slides');
    expect(attachmentFolder('notes.md', 'papers', NOW)).toBe('3 Resources/papers');
  });

  it('classifies files by extension', () => {
    expect(fileKindOf('a.JPEG')).toBe('image');
    expect(fileKindOf('a.svg')).toBe('image');
    expect(fileKindOf('a.pdf')).toBe('pdf');
    expect(fileKindOf('a.pptx')).toBe('document');
    expect(fileKindOf('a.md')).toBe('note');
    expect(fileKindOf('a.html')).toBe('other');
    expect(fileKindOf('README')).toBe('other');
  });
});
