import { afterEach, describe, expect, it } from 'vitest';
import { renderSemesterPage } from '../../src/semester/semester-page-content.js';
import { collectSemesterRows } from '../../src/semester/semester-page-rows.js';
import { createIndexedVault, type IndexedVault } from '../index/helpers/index-test-vault.js';
import { FIXTURE_TODAY as TODAY, SEMESTER_FIXTURE } from './semester-test-host.js';

let v: IndexedVault | null = null;
afterEach(async () => {
  await v?.cleanup();
  v = null;
});

async function pageFor(language: 'vi' | 'en'): Promise<string> {
  v ??= await createIndexedVault({ files: SEMESTER_FIXTURE });
  const rows = collectSemesterRows(v.index, TODAY);
  return renderSemesterPage({ rows, catalog: v.index.linkCatalog(), language, created: TODAY });
}

describe('"Học kỳ này" page content (F25.1)', () => {
  it('(F25.1) lists courses with lectures and projects by course; archived, done and templates left out', async () => {
    const csharp = `2%20Areas/${encodeURIComponent('C# cơ bản.md')}`;
    expect(await pageFor('vi')).toBe(
      [
        '---',
        'type: note',
        'generated: true',
        `created: ${TODAY}`,
        '---',
        '> Trang này do Second Brain tạo tự động từ các ghi chú môn học và đồ án. Muốn đổi thì sửa các ghi chú đó.',
        '',
        '## Môn học',
        '',
        `- [C# cơ bản](${csharp}): chưa có bài giảng`,
        '- [[Giải tích 1]]: 2 bài giảng',
        '- [[Xác suất thống kê]]: 1 bài giảng',
        '',
        '## Đồ án',
        '',
        '### [[Giải tích 1]]',
        '',
        '- [[1 Projects/Giải tích/Báo cáo cuối kỳ]]: hạn 02/03/2026, đến hạn hôm nay, xong 1/1 việc',
        '- [[Đồ án Giải tích]]: hạn 14/03/2026, còn 12 ngày, xong 3/5 việc',
        '',
        '### [[Xác suất thống kê]]',
        '',
        '- [[1 Projects/Xác suất/Báo cáo cuối kỳ]]: chưa có hạn, chưa có việc',
        '',
        '### Khác',
        '',
        '- [[Research – Tìm research gap]]: hạn 27/02/2026, quá hạn 3 ngày, chưa có việc',
        '- [[Web bán hàng]]: chưa có hạn, chưa có việc',
        '',
      ].join('\n'),
    );
  });

  it('(F25.1) every link of the page resolves to the note it names (path form for ambiguous titles)', async () => {
    const content = await pageFor('vi');
    await v!.put('Học kỳ này.md', content);
    const links = v!.index.outlinks('Học kỳ này.md');
    expect(links.every((link) => link.toPath !== null && !link.ambiguous)).toBe(true);
    expect(links.map((link) => link.toPath).sort()).toEqual(
      [
        '1 Projects/Giải tích/Báo cáo cuối kỳ.md',
        '1 Projects/Research – Tìm research gap.md',
        '1 Projects/Web bán hàng.md',
        '1 Projects/Xác suất/Báo cáo cuối kỳ.md',
        '1 Projects/Đồ án Giải tích.md',
        '2 Areas/C# cơ bản.md',
        '2 Areas/Giải tích 1.md',
        '2 Areas/Giải tích 1.md',
        '2 Areas/Xác suất thống kê.md',
        '2 Areas/Xác suất thống kê.md',
      ].sort(),
    );
    // The page itself adds no deadline items or tasks.
    expect(v!.index.getNote('Học kỳ này.md')).toMatchObject({ deadline: null, type: 'note' });
    expect(v!.index.allTasks().some((task) => task.path === 'Học kỳ này.md')).toBe(false);
  });

  it('is written in English when the UI is English', async () => {
    const page = await pageFor('en');
    expect(page).toContain('## Courses\n');
    expect(page).toContain('- [[Giải tích 1]]: 2 lectures\n');
    expect(page).toContain('- [[Xác suất thống kê]]: 1 lecture\n');
    expect(page).toContain(
      '- [[Đồ án Giải tích]]: due 14 March 2026, 12 days left, 3/5 tasks done\n',
    );
    expect(page).toContain(
      '- [[Research – Tìm research gap]]: due 27 February 2026, 3 days overdue',
    );
    expect(page).toContain('### Other\n');
  });

  it('an empty vault gets the inviting sentences', async () => {
    v = await createIndexedVault();
    const rows = collectSemesterRows(v.index, TODAY);
    const page = renderSemesterPage({
      rows,
      catalog: v.index.linkCatalog(),
      language: 'vi',
      created: TODAY,
    });
    expect(page).toContain('Chưa có môn học nào.');
    expect(page.endsWith('## Đồ án\n\nChưa có đồ án nào đang làm.\n')).toBe(true);
  });
});
