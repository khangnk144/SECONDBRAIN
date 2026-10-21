import { addDays } from '../lib/local-date.js';
import type { SampleFile } from './sample-file.js';
import { samplePaperPages } from './sample-paper-pages.js';
import { SAMPLE_PAPERS } from './sample-papers.js';

export const SAMPLE_RESEARCH_GAP_PATH = 'wiki/research-gaps/tim-research-gap.md';

/** `wiki/index.md` and `wiki/log.md` in the formats `CLAUDE.md` describes. */
function controlDocs(today: string): SampleFile[] {
  const ingestedOn = addDays(today, -2);
  const index = [
    '# Mục lục wiki',
    '',
    'Trang này liệt kê mọi trang trong `wiki/`. AI cập nhật nó sau mỗi lần nạp tài liệu.',
    '',
    '## Bài báo',
    '',
    ...SAMPLE_PAPERS.map((paper) => `- [[${paper.slug}]]: ${paper.title}`),
    '',
    '## Khái niệm',
    '',
    '- [[Phân tích học tập]]',
    '- [[Mô hình giải thích được]]',
    '',
    '## Research gap',
    '',
    '- [[tim-research-gap]]: khoảng trống cho đề tài nghiên cứu',
    '',
  ].join('\n');
  const log = [
    '# Nhật ký wiki',
    '',
    'Mỗi dòng ghi một lần AI nạp tài liệu hoặc rà soát wiki. Chỉ được thêm vào cuối.',
    '',
    ...SAMPLE_PAPERS.map((paper) => `## [${ingestedOn}] ingest | ${paper.title}`),
    '',
  ].join('\n');
  return [
    { path: 'wiki/index.md', content: index },
    { path: 'wiki/log.md', content: log },
  ];
}

function conceptPages(today: string): SampleFile[] {
  const created = addDays(today, -2);
  const analytics = [
    '---',
    'type: wiki',
    `created: ${created}`,
    '---',
    '',
    '# Phân tích học tập',
    '',
    'Phân tích học tập (learning analytics) là việc thu thập và phân tích dữ liệu về người học',
    'để hiểu và cải thiện việc học.',
    '',
    '- Nguồn dữ liệu phổ biến nhất là log của hệ thống quản lý học tập ([[learning-analytics-survey]]).',
    '- Dữ liệu hoạt động hằng tuần đủ để dự đoán bỏ học từ tuần thứ 4 ([[dropout-prediction-sequence-models]]).',
    '- Kết quả dự đoán hữu ích hơn khi kèm lời giải thích ([[explainable-grade-prediction]]).',
    '',
  ].join('\n');
  const explainable = [
    '---',
    'type: wiki',
    `created: ${created}`,
    '---',
    '',
    '# Mô hình giải thích được',
    '',
    'Mô hình cho biết vì sao nó đưa ra một dự đoán, ví dụ đặc trưng nào làm điểm dự đoán giảm.',
    '',
    '- Giảng viên dùng phần giải thích để chọn sinh viên cần liên hệ trước ([[explainable-grade-prediction]]).',
    '- Liên quan: [[Phân tích học tập]].',
    '',
  ].join('\n');
  return [
    { path: 'wiki/concepts/Phân tích học tập.md', content: analytics },
    { path: 'wiki/concepts/Mô hình giải thích được.md', content: explainable },
  ];
}

/** Written as a scoped hypothesis, the way `CLAUDE.md` asks research-gap pages to be. */
function researchGapPage(today: string): SampleFile {
  const content = [
    '---',
    'type: wiki',
    'project: "[[Research – Tìm research gap]]"',
    `created: ${addDays(today, -2)}`,
    '---',
    '',
    '# Research gap: dự đoán kết quả học tập sớm',
    '',
    '## Giả thuyết',
    '',
    'Trong 3 nguồn đã đọc, chưa thấy nghiên cứu nào dùng dữ liệu lớp học trực tiếp ở một trường',
    'đại học Việt Nam để dự đoán sớm kết quả học tập kèm lời giải thích cho giảng viên.',
    '',
    '## Bằng chứng',
    '',
    '- Phần lớn nghiên cứu chỉ dùng dữ liệu một môn, một học kỳ ([[learning-analytics-survey]]).',
    '- Mô hình chuỗi mới chỉ thử trên khóa học trực tuyến ([[dropout-prediction-sequence-models]]).',
    '- Nghiên cứu có giải thích chỉ có dữ liệu từ một trường, không ở châu Á ([[explainable-grade-prediction]]).',
    '',
    '## Phản chứng',
    '',
    '- Bài tổng quan có thể đã bỏ sót các hội thảo trong nước.',
    '',
    '## Cần tìm thêm',
    '',
    '- Kỷ yếu hội thảo giáo dục ở Việt Nam 3 năm gần đây.',
    '- Dữ liệu điểm danh và bài tập của lớp học trực tiếp.',
    '',
  ].join('\n');
  return { path: SAMPLE_RESEARCH_GAP_PATH, content };
}

/** Paper pages first (they link to the PDFs), then index, log, concepts and the research gap. */
export function sampleWikiFiles(today: string): SampleFile[] {
  return [
    ...samplePaperPages(today),
    ...controlDocs(today),
    ...conceptPages(today),
    researchGapPage(today),
  ];
}
