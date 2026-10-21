import { createHash } from 'node:crypto';
import { addDays } from '../lib/local-date.js';
import type { SampleFile } from './sample-file.js';
import {
  SAMPLE_PAPERS,
  samplePaperPdf,
  samplePaperPdfPath,
  type SamplePaper,
} from './sample-papers.js';

/**
 * The three sample paper pages in `wiki/papers/`, in the paper-page format of `CLAUDE.md`. The
 * generated PDFs hold only a title and an abstract, so every claim cites page 1 and whatever the
 * abstract does not say is written as "Bài báo không nói rõ." – the honesty the format asks for.
 */
interface PaperSections {
  summary: string;
  problem: string;
  input: string;
  output: string;
  existing: string;
  gap: string;
  idea: string;
  details: string;
  data: string[];
  experiments: string[];
  results: string;
  limits: string;
  aiNote: string;
}

const NOT_SAID = 'Bài báo không nói rõ.';
/** Title of `wiki/research-gaps/tim-research-gap.md`, which every sample paper feeds. */
const GAP_TITLE = 'tim-research-gap';

const SECTIONS: Readonly<Record<string, PaperSections>> = {
  'learning-analytics-survey': {
    summary:
      'Bài tổng quan 120 nghiên cứu dùng log của hệ thống quản lý học tập (LMS) để dự đoán kết quả học tập của sinh viên (tr. 1).',
    problem: 'Dùng dữ liệu hoạt động trên LMS để sớm biết sinh viên nào cần được hỗ trợ (tr. 1).',
    input: 'log hoạt động của sinh viên trên hệ thống học tập (tr. 1).',
    output: 'dự đoán kết quả học tập của sinh viên (tr. 1).',
    existing:
      'Phần lớn nghiên cứu lấy dữ liệu của một môn trong một học kỳ rồi huấn luyện mô hình dự đoán trên chính dữ liệu đó (tr. 1).',
    gap: 'Ít nghiên cứu kiểm tra mô hình có dùng được ở trường khác hay không (tr. 1).',
    idea: 'Đọc và xếp nhóm 120 nghiên cứu để thấy bức tranh chung của lĩnh vực (tr. 1).',
    details: 'Nhóm theo nguồn dữ liệu, mục tiêu dự đoán và cách đánh giá (tr. 1).',
    data: [
      '120 nghiên cứu đã công bố, đều dùng log LMS (tr. 1).',
      `Tên từng bộ dữ liệu: ${NOT_SAID}`,
    ],
    experiments: [`Bài tổng quan không chạy thí nghiệm riêng. ${NOT_SAID}`],
    results:
      'Phần lớn nghiên cứu chỉ dùng dữ liệu một môn, một học kỳ; ít bài báo cáo mô hình có chuyển sang trường khác được không (tr. 1).',
    limits:
      'Các vấn đề còn mở: mẫu nhỏ, thiếu dữ liệu từ lớp học trực tiếp, ít bằng chứng rằng dự đoán giúp giảng viên dạy tốt hơn (tr. 1).',
    aiNote: 'Bài tổng quan hữu ích để định vị đề tài; cần đọc danh sách tài liệu tham khảo.',
  },
  'dropout-prediction-sequence-models': {
    summary:
      'Dự đoán sinh viên bỏ khóa học trực tuyến từ hoạt động hằng tuần, bằng mô hình chuỗi (tr. 1).',
    problem: 'Biết sớm sinh viên nào có nguy cơ bỏ khóa học (tr. 1).',
    input:
      'số lần đăng nhập, thời gian xem video và số lần làm quiz của từng sinh viên theo tuần (tr. 1).',
    output: 'khả năng sinh viên đó bỏ khóa học (tr. 1).',
    existing: `Hồi quy logistic trên cùng dữ liệu, được dùng làm mốc so sánh (tr. 1). Các cách khác: ${NOT_SAID}`,
    gap: NOT_SAID,
    idea: 'Đọc hoạt động của sinh viên theo thứ tự từng tuần, như đọc một chuỗi, để đoán ai sắp bỏ học (tr. 1).',
    details: 'Mạng hồi quy (recurrent) trên số liệu hoạt động hằng tuần (tr. 1).',
    data: ['Ba khóa học trực tuyến (tr. 1).', `Tên khóa học, số sinh viên và nguồn: ${NOT_SAID}`],
    experiments: [
      'So sánh với (baseline): hồi quy logistic (tr. 1).',
      'Thước đo (metric): AUC (tr. 1).',
    ],
    results: 'Đến tuần thứ 4, AUC đạt 0,86, so với 0,78 của hồi quy logistic (tr. 1).',
    limits:
      'Mọi khóa học đều trực tuyến; chưa biết mô hình chạy thế nào với sinh viên học chủ yếu trên lớp (tr. 1).',
    aiNote: 'Chỉ có khóa học trực tuyến; chưa rõ áp dụng cho lớp học trực tiếp.',
  },
  'explainable-grade-prediction': {
    summary:
      'Dự đoán điểm cuối kỳ của sinh viên và giải thích từng dự đoán, để giảng viên can thiệp sớm (tr. 1).',
    problem: 'Giúp giảng viên biết sớm sinh viên nào có thể bị điểm thấp, và vì sao (tr. 1).',
    input: `dữ liệu học tập của sinh viên ở một trường đại học (tr. 1); các đặc trưng cụ thể: ${NOT_SAID}`,
    output: 'điểm cuối kỳ dự đoán, kèm lời giải thích yếu tố nào ảnh hưởng (tr. 1).',
    existing: NOT_SAID,
    gap: NOT_SAID,
    idea: 'Dự đoán điểm rồi chỉ ra yếu tố nào kéo điểm dự đoán lên hay xuống (tr. 1).',
    details:
      'Cây tăng cường gradient (gradient boosted trees) và giải thích theo từng đặc trưng; sau đó phỏng vấn 12 giảng viên (tr. 1).',
    data: [
      '2.400 sinh viên của một trường đại học, trong hai năm học (tr. 1).',
      `Tên trường: ${NOT_SAID}`,
    ],
    experiments: [
      'Phỏng vấn 12 giảng viên về phần giải thích (tr. 1).',
      `So sánh với (baseline) và thước đo (metric): ${NOT_SAID}`,
    ],
    results: 'Giảng viên nói phần giải thích giúp họ chọn sinh viên cần liên hệ trước (tr. 1).',
    limits:
      'Dữ liệu của một trường trong hai năm; chưa nghiên cứu ở nước khác, cũng chưa xem sinh viên phản ứng thế nào khi được liên hệ (tr. 1).',
    aiNote: 'Mẫu từ một trường; không có dữ liệu từ châu Á.',
  },
};

function paperPage(paper: SamplePaper, hash: string, on: string): string {
  const { slug, title, authors } = paper;
  const s = SECTIONS[slug];
  if (!s) throw new Error(`No sample sections for ${slug}`);
  // `Nguồn` first, as the CLAUDE.md paper format asks: the map's edge from the page to its PDF.
  const related = [
    `Nguồn: [[${slug}.pdf]]`,
    ...paper.concepts.map((c) => `[[${c}]]`),
    `[[${GAP_TITLE}]]`,
  ];
  const list = (lines: string[]) => lines.map((line) => `- ${line}`).join('\n');
  const frontMatter = [
    '---',
    'type: paper',
    `title: "${title}"`,
    `authors: [${authors.join(', ')}]`,
    'year: 2024',
    `source: ${samplePaperPdfPath(slug)}`,
    `source_hash: ${hash}`,
    'pages_covered: 1',
    'verified: false',
    `ingested_at: ${on}`,
    `created: ${on}`,
    '---',
  ].join('\n');
  // One block per paragraph, separated by a blank line.
  const blocks = [
    ...[frontMatter, `# ${title}`],
    ...['## Tóm tắt', s.summary, '## Bài toán', s.problem],
    ...[`**Input:** ${s.input}`, `**Output:** ${s.output}`],
    ...['## Các cách hiện có', s.existing, '## Khoảng trống và động lực', s.gap],
    ...['## Phương pháp', `**Ý chính:** ${s.idea}`, `**Chi tiết:** ${s.details}`],
    ...['## Dữ liệu', list(s.data), '## Thí nghiệm', list(s.experiments)],
    ...['## Kết quả (theo tác giả)', s.results, '## Hạn chế và hướng tiếp theo', s.limits],
    ...['## Nhận xét của AI', `${s.aiNote} Trang này là dữ liệu mẫu, chưa được kiểm tra.`],
    ...['## Liên quan', list(related)],
  ];
  return `${blocks.join('\n\n')}\n`;
}

/** `wiki/papers/<slug>.md` for each sample paper; `source_hash` is the hash of its PDF. */
export function samplePaperPages(today: string): SampleFile[] {
  const ingestedOn = addDays(today, -2);
  return SAMPLE_PAPERS.map((paper) => {
    const hash = createHash('sha256').update(samplePaperPdf(paper)).digest('hex');
    return {
      path: `wiki/papers/${paper.slug}.md`,
      content: paperPage(paper, hash, ingestedOn),
    };
  });
}
