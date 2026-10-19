import { addDays } from '../lib/local-date.js';
import type { SampleFile } from './sample-file.js';
import { SAMPLE_PAPERS } from './sample-papers.js';
import { SAMPLE_RESEARCH_GAP_PATH } from './sample-wiki-pages.js';

const note = (frontmatter: string[], body: string[]): string =>
  ['---', ...frontmatter, '---', '', ...body, ''].join('\n');

function courses(today: string): SampleFile[] {
  const created = addDays(today, -30);
  return [
    {
      path: '2 Areas/Giải tích 1.md',
      content: note(
        ['type: course', 'tags: [giải-tích]', `created: ${created}`],
        [
          '# Giải tích 1',
          '',
          'Học thứ Hai và thứ Năm, phòng B4-201. Giảng viên: thầy Hùng.',
          '',
          '## Nội dung chính',
          '',
          '- Giới hạn và liên tục',
          '- Đạo hàm và ứng dụng',
          '- Tích phân xác định #môn/giải-tích',
          '',
          'Đồ án của môn: [[Đồ án Giải tích]].',
        ],
      ),
    },
    {
      path: '2 Areas/Xác suất thống kê.md',
      content: note(
        ['type: course', 'tags: [xác-suất]', `created: ${created}`],
        [
          '# Xác suất thống kê',
          '',
          'Học thứ Ba, phòng C2-105. Bài tập nộp trên hệ thống mỗi tuần.',
          '',
          '## Công thức cần nhớ',
          '',
          '- Công thức Bayes',
          '- Kỳ vọng và phương sai của phân phối nhị thức',
        ],
      ),
    },
  ];
}

function projects(today: string): SampleFile[] {
  const papers = SAMPLE_PAPERS.map((paper) => `- [[${paper.slug}]]`);
  const gap = SAMPLE_RESEARCH_GAP_PATH.replace(/\.md$/, '');
  return [
    {
      path: '1 Projects/Đồ án Giải tích.md',
      content: note(
        [
          'type: project',
          'status: doing',
          `deadline: ${addDays(today, 12)}`,
          'course: "[[Giải tích 1]]"',
          'tags: [đồ-án, giải-tích]',
          `created: ${addDays(today, -10)}`,
        ],
        [
          '# Đồ án Giải tích',
          '',
          'Đề tài: ứng dụng tích phân để tính diện tích và thể tích. #đồ-án',
          '',
          '## Việc cần làm',
          '',
          `- [x] Chọn đề tài với nhóm ✅ ${addDays(today, -6)}`,
          `- [x] Đọc lại chương tích phân xác định ✅ ${addDays(today, -4)}`,
          `- [x] Lập dàn ý báo cáo ✅ ${addDays(today, -2)}`,
          `- [ ] Giải 10 bài tập mẫu 📅 ${addDays(today, 1)}`,
          `- [ ] Viết bản nháp báo cáo 📅 ${addDays(today, 5)}`,
          '',
          '## Ghi chú',
          '',
          'Tài liệu chính là giáo trình của [[Giải tích 1]].',
        ],
      ),
    },
    {
      path: '1 Projects/Research – Tìm research gap.md',
      content: note(
        ['type: research', 'status: doing', 'tags: [nghiên-cứu]', `created: ${addDays(today, -7)}`],
        [
          '# Research: tìm research gap',
          '',
          'Chủ đề: dự đoán sớm kết quả học tập của sinh viên.',
          '',
          '## Bài đã đọc',
          '',
          ...papers,
          '',
          `Khoảng trống đang theo dõi: [[${gap}]].`,
        ],
      ),
    },
  ];
}

/** Two notes with the same title in different folders: `[[Ghi chú]]` is ambiguous on purpose. */
function ambiguousPair(today: string): SampleFile[] {
  const created = addDays(today, -5);
  return [
    {
      path: '1 Projects/Ghi chú.md',
      content: note(
        ['type: note', `created: ${created}`],
        ['# Ghi chú cho các dự án', '', 'Họp nhóm đồ án vào tối thứ Tư.'],
      ),
    },
    {
      path: '2 Areas/Ghi chú.md',
      content: note(
        ['type: note', `created: ${created}`],
        ['# Ghi chú chung', '', 'Lịch thi giữa kỳ xem trên trang của khoa.'],
      ),
    },
  ];
}

function inbox(today: string): SampleFile[] {
  const created = addDays(today, -1);
  return [
    {
      path: '0 Inbox/Ý tưởng đề tài nghiên cứu.md',
      content: note(
        ['type: note', `created: ${created}`],
        ['Thử dùng dữ liệu điểm danh để dự đoán sinh viên cần hỗ trợ sớm?'],
      ),
    },
    {
      path: '0 Inbox/Sách cần mượn.md',
      content: note(
        ['type: note', `created: ${created}`],
        ['- Giáo trình Giải tích 1, tập 2', '- Xác suất thống kê và ứng dụng'],
      ),
    },
  ];
}

/** The last three Daily notes: a task due today, an overdue one, and the ambiguous link. */
function dailyNotes(today: string): SampleFile[] {
  const daily = (offset: number, body: string[]): SampleFile => {
    const date = addDays(today, offset);
    return { path: `Daily/${date}.md`, content: note(['type: daily', `created: ${date}`], body) };
  };
  return [
    daily(0, [
      '## Hôm nay',
      '',
      `- [ ] Nộp bài tập Xác suất thống kê 📅 ${today}`,
      '- [ ] Ôn lại công thức Bayes',
      '',
      'Buổi chiều học [[Giải tích 1]].',
    ]),
    daily(-1, [
      '## Hôm qua',
      '',
      `- [ ] Gửi email hỏi thầy về đồ án 📅 ${addDays(today, -1)}`,
      `- [x] Đi học Giải tích ✅ ${addDays(today, -1)}`,
    ]),
    daily(-2, ['## Ghi lại', '', 'Đã chép lịch họp vào [[Ghi chú]].']),
  ];
}

export function sampleStudyNotes(today: string): SampleFile[] {
  return [
    ...courses(today),
    ...projects(today),
    ...ambiguousPair(today),
    ...inbox(today),
    ...dailyNotes(today),
  ];
}
