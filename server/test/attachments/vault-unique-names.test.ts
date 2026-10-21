import { describe, expect, it } from 'vitest';
import {
  isNameTaken,
  nameCandidates,
  nameLinksUniquely,
  takenNameKeys,
} from '../../src/attachments/vault-unique-names.js';
import { buildLinkCatalog } from '../../src/markdown/link-catalog.js';

const catalog = buildLinkCatalog([
  'Attachments/2026-10/image.png',
  '3 Resources/papers/Bài giảng 3.pdf',
  '0 Inbox/báo cáo.pdf.md',
  '2 Areas/Giải tích 1.md',
  'Templates/Mẫu.md',
]);

describe('vault-wide unique attachment names (SPEC §4.8)', () => {
  const taken = takenNameKeys(catalog);

  it('treats file names case- and NFC-insensitively', () => {
    expect(isNameTaken(taken, 'IMAGE.PNG')).toBe(true);
    expect(isNameTaken(taken, 'bài giảng 3.pdf'.normalize('NFD'))).toBe(true);
    expect(isNameTaken(taken, 'image 2.png')).toBe(false);
  });

  it('a note title blocks the same file name, and a note blocks an uploaded note', () => {
    expect(isNameTaken(taken, 'Báo cáo.pdf')).toBe(true);
    expect(isNameTaken(taken, 'giải tích 1.md')).toBe(true);
    expect(isNameTaken(taken, 'Giải tích 1.MD')).toBe(true);
    expect(isNameTaken(taken, 'mẫu.md')).toBe(true);
  });

  it('keeps distinct letters apart (đ is not d)', () => {
    expect(isNameTaken(taken, 'Bai giang 3.pdf')).toBe(false);
  });

  it('suffixes " 2", " 3", … before the extension', () => {
    const candidates = nameCandidates('image.png');
    expect([0, 1, 2].map(() => candidates.next().value)).toEqual([
      'image.png',
      'image 2.png',
      'image 3.png',
    ]);
    expect(nameCandidates('README').next().value).toBe('README');
  });

  it('uses the title form only while the name names exactly one file', () => {
    expect(nameLinksUniquely(catalog, 'Attachments/2026-10/image.png')).toBe(true);
    const duplicated = buildLinkCatalog([
      'Attachments/2026-10/image.png',
      'Attachments/2026-11/Image.png',
    ]);
    expect(nameLinksUniquely(duplicated, 'Attachments/2026-10/image.png')).toBe(false);
    const shadowed = buildLinkCatalog(['3 Resources/papers/báo cáo.pdf', '0 Inbox/Báo cáo.pdf.md']);
    expect(nameLinksUniquely(shadowed, '3 Resources/papers/báo cáo.pdf')).toBe(false);
    const notes = buildLinkCatalog(['3 Resources/other/nguồn.md', 'wiki/Nguồn.md']);
    expect(nameLinksUniquely(notes, '3 Resources/other/nguồn.md')).toBe(false);
  });
});
