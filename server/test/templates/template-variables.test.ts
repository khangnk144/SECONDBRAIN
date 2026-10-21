import { describe, expect, it } from 'vitest';
import { BUNDLED_TEMPLATES } from '../../src/templates/bundled-templates.js';
import { fillTemplate, type TemplateContext } from '../../src/templates/template-variables.js';

const at = (overrides: Partial<TemplateContext> = {}): TemplateContext => ({
  title: '2026-10-19',
  date: '2026-10-19',
  now: new Date(2026, 9, 20, 9, 5),
  language: 'vi',
  ...overrides,
});
const daily = BUNDLED_TEMPLATES.find((t) => t.name === 'Daily.md')!.content;

describe('template variables in the UI language (F13.2, F14.2)', () => {
  it('fills the bundled Daily template in Vietnamese and English', () => {
    const vi = fillTemplate(daily, at());
    expect(vi.content).toContain('created: 2026-10-19\n');
    expect(vi.content).toContain('# thứ hai, 19 tháng 10 2026\n');
    expect(vi.content).toContain('← [[2026-10-18]] · [[2026-10-20]] →');
    expect(vi.content).not.toContain('{{');
    const en = fillTemplate(daily, at({ language: 'en' }));
    expect(en.content).toContain('# Monday, 19 October 2026\n');
  });

  it('reports the UTF-16 offset of {{cursor}} in the written text and removes every marker', () => {
    const { content, cursor } = fillTemplate(daily, at());
    expect(cursor).not.toBeNull();
    expect(content.slice(0, cursor!)).toMatch(/## Việc hôm nay\n\n$/);
    expect(content.slice(cursor!)).toMatch(/^\n\n## Ghi chép/);
    const twice = fillTemplate('😀 {{title}}{{cursor}} và {{cursor}}!', at({ title: 'Đồ án' }));
    expect(twice).toEqual({ content: '😀 Đồ án và !', cursor: '😀 Đồ án'.length });
    expect(fillTemplate('# {{title}}', at()).cursor).toBeNull();
  });

  it('inserts values literally and leaves unknown variables as written', () => {
    const { content } = fillTemplate(
      '{{title}} | {{time}} | {{time:HH:mm:ss}} | {{date:}} | {{title:x}} | {{tên}} | {{other}}',
      at({ title: 'Bài $1 & {{cursor}} $&' }),
    );
    expect(content).toBe(
      'Bài $1 & {{cursor}} $& | 09:05 | 09:05:00 | 2026-10-19 | {{title:x}} | {{tên}} | {{other}}',
    );
  });

  it('yesterday and tomorrow cross month and year boundaries', () => {
    expect(fillTemplate('{{yesterday}} {{tomorrow}}', at({ date: '2027-01-01' })).content).toBe(
      '2026-12-31 2027-01-02',
    );
    expect(fillTemplate('{{yesterday}} {{tomorrow}}', at({ date: '2028-02-28' })).content).toBe(
      '2028-02-27 2028-02-29',
    );
    expect(fillTemplate('{{date:dddd D/M}}', at({ date: '2028-02-29' })).content).toBe(
      'thứ ba 29/2',
    );
  });
});
