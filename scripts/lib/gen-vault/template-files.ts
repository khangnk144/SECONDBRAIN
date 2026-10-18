// Template files for the generated vault. They intentionally contain a dated task so tests can
// prove templates are never counted as tasks or deadlines.
import { addDays } from './prng.js';

export function templateFiles(today: string): Record<string, string> {
  const due = addDays(today, 3);
  const projectTemplate = [
    '---',
    'type: project',
    'status: todo',
    `deadline: {{date}}`,
    'course: "[[{{title}}]]"',
    'created: {{date}}',
    '---',
    '',
    '## Yêu cầu',
    '',
    '{{cursor}}',
    '',
    '## Việc cần làm',
    '',
    '- [ ] Chọn đề tài',
    `- [ ] Nộp bản nháp 📅 ${due}`,
    '- [ ] Nộp bản cuối',
    '',
    '## Ghi chú',
    '',
    '## Tài liệu',
    '',
  ].join('\n');
  const simple = (type: string, sections: string[]) =>
    [
      '---',
      `type: ${type}`,
      'created: {{date}}',
      '---',
      '',
      ...sections.flatMap((s) => [`## ${s}`, '']),
      '{{cursor}}',
      '',
    ].join('\n');
  return {
    'Templates/Course project.md': projectTemplate,
    'Templates/Course.md': simple('course', ['Thông tin môn', 'Bài giảng', 'Tài liệu']),
    'Templates/Lecture.md': simple('lecture', ['Nội dung', 'Câu hỏi']),
    'Templates/Paper.md': simple('paper', ['Tóm tắt', 'Phương pháp', 'Kết quả (theo tác giả)']),
    'Templates/Research project.md': simple('research', ['Câu hỏi nghiên cứu', 'Tiến độ']),
    'Templates/Book.md': simple('book', ['Ý chính', 'Trích dẫn']),
    'Templates/Daily.md': [
      '# {{date:dddd, D MMMM YYYY}}',
      '',
      '## Hôm nay',
      '',
      '- [ ] {{cursor}}',
      '',
    ].join('\n'),
    'Templates/Note.md': simple('note', ['Ghi chú']),
  };
}

/** Standard vault folders (SPEC folder layout), created even when empty. */
export const VAULT_FOLDERS = [
  '0 Inbox',
  '1 Projects',
  '2 Areas',
  '3 Resources/papers',
  '3 Resources/slides',
  '3 Resources/web',
  '3 Resources/other',
  '4 Archive',
  'wiki/papers',
  'wiki/concepts',
  'wiki/research-gaps',
  'Daily',
  'Templates',
  'Attachments',
] as const;
