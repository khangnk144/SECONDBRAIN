import { describe, expect, it } from 'vitest';
import { isExecutableFileName } from '../../src/attachments/open-external-command.js';

describe('files that are never opened with the OS from the app (F15)', () => {
  it.each(['docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppam', 'sldm'])(
    'refuses the macro-enabled Office type .%s in any letter case',
    (extension) => {
      expect(isExecutableFileName(`3 Resources/other/Bài tập ${extension}.${extension}`)).toBe(
        true,
      );
      expect(isExecutableFileName(`Báo cáo.${extension.toUpperCase()}`)).toBe(true);
    },
  );

  it('still opens the plain Office, PDF and image types', () => {
    for (const name of ['Đề cương.docx', 'Điểm.xlsx', 'Slide.pptx', 'Mẫu.dotx', 'bài.pdf', 'a.png'])
      expect(isExecutableFileName(name), name).toBe(false);
  });
});
