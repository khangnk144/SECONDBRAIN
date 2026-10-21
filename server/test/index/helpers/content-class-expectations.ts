/**
 * The content-class fixture (`fixtures/index/content-classes`) and its expectation table
 * (SPEC §4.2/§4.7), shared by the deadline-service test and the API agreement test.
 */
import { fixtureFiles } from './index-test-vault.js';

/** Wednesday 21 Oct 2026, 10:00 local. The week is Mon 19 – Sun 25. */
export const FIXTURE_NOW = new Date(2026, 9, 21, 10, 0);
export const FIXTURE_TODAY = '2026-10-21';
export const FIXTURE_FILES = fixtureFiles('content-classes');
export const FIXTURE_PROJECT = '1 Projects/Đồ án Giải tích.md';

/** `task:<path>#<line>` for the fixture line holding `text`. */
export function fixtureTaskId(path: string, text: string): string {
  const content = FIXTURE_FILES[path]?.toString('utf8') ?? '';
  const line = content.split('\n').findIndex((l) => l.includes(text));
  if (line === -1) throw new Error(`no line ${text}`);
  return `task:${path}#${line + 1}`;
}

const P = FIXTURE_PROJECT;

/**
 * Every item the fixture must produce. Templates, sources, wiki pages, control docs and
 * attachments contribute none; archived ones only on request.
 */
export const EXPECTED_ITEMS = (
  [
    [`note:${P}`, '2026-11-02', false, 'ok', false],
    [fixtureTaskId(P, 'Viết báo cáo'), '2026-10-22', false, 'urgent', false],
    [fixtureTaskId(P, 'Làm slide'), '2026-10-26', false, 'soon', false],
    [fixtureTaskId(P, 'Nộp bài'), '2026-10-19', false, 'urgent', false],
    ['note:1 Projects/Đồ án xong.md', '2026-10-22', true, 'done', false],
    [fixtureTaskId('1 Projects/Đồ án xong.md', 'Still open'), '2026-10-21', true, 'done', false],
    ['note:1 Projects/Đồ án trống.md', '2026-10-31', false, 'ok', false],
    ['note:1 Projects/Hai mục.md', '2026-10-25', false, 'soon', false],
    [fixtureTaskId('1 Projects/Hai mục.md', 'Cùng ngày'), '2026-10-25', false, 'soon', false],
    [fixtureTaskId('Daily/2026-10-21.md', 'Có hạn hôm nay'), FIXTURE_TODAY, false, 'urgent', false],
    ['note:4 Archive/Đồ án cũ.md', '2026-10-24', false, 'soon', true],
    [fixtureTaskId('4 Archive/Đồ án cũ.md', 'Archived task'), '2026-10-23', false, 'urgent', true],
  ] as const
).map(([id, date, done, urgency, archived]) => ({ id, date, done, urgency, archived }));

export const visibleItems = (includeArchive: boolean) =>
  EXPECTED_ITEMS.filter((r) => includeArchive || !r.archived);

export const sortedIds = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

/** Files that produce no item and no task in any view, whatever they contain. */
export const QUIET_FILES = [
  'Templates/Mẫu có hạn.md',
  '3 Resources/web/Bài viết.md',
  'wiki/concepts/Đạo hàm.md',
  'wiki/index.md',
  'CLAUDE.md',
  'Attachments/ghi chú.md',
];
