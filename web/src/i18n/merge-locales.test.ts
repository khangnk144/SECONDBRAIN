import { describe, expect, it } from 'vitest';
import { groupAreaFiles, mergeLocale } from './merge-locales';

describe('feature area locale files', () => {
  it('groups files by language and area and merges them under the area key', () => {
    const grouped = groupAreaFiles({
      './locales/editor.vi.json': { save: 'Lưu' },
      './locales/editor.en.json': { save: 'Save' },
      './locales/README.md': {},
    });
    expect(grouped).toEqual({ vi: { editor: { save: 'Lưu' } }, en: { editor: { save: 'Save' } } });
    expect(mergeLocale({ app: { x: 'y' } }, grouped.vi)).toEqual({
      app: { x: 'y' },
      editor: { save: 'Lưu' },
    });
  });

  it('refuses an area that reuses a core key', () => {
    expect(() => mergeLocale({ editor: 'x' }, { editor: { a: 'b' } })).toThrow(/collides/);
  });
});
