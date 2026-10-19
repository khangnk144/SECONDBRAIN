import { createHash } from 'node:crypto';
import { addDays } from '../lib/local-date.js';
import { writeOnePagePdf } from './minimal-pdf-writer.js';
import type { SampleFile } from './sample-file.js';

/**
 * Three invented papers for the sample research project. The PDFs say plainly that they are
 * generated sample data so nobody mistakes them for real publications.
 */
interface SamplePaper {
  slug: string;
  title: string;
  authors: string[];
  abstract: string[];
  summary: string;
  method: string;
  results: string;
  aiNote: string;
  concepts: string[];
}

export const SAMPLE_PAPERS: readonly SamplePaper[] = [
  {
    slug: 'learning-analytics-survey',
    title: 'Learning Analytics for Student Success: A Survey',
    authors: ['Linh Tran', 'Minh Pham'],
    abstract: [
      'We review 120 studies that use learning management system logs to predict student ' +
        'outcomes. Most studies use data from a single course in a single semester, and only ' +
        'a few report whether their models transfer to other institutions.',
      'We group the studies by data source, prediction target and evaluation method, and list ' +
        'open problems: small samples, missing data from offline classes, and little evidence ' +
        'that predictions lead to better teaching decisions.',
    ],
    summary: 'Tổng quan 120 nghiên cứu dùng log hệ thống học tập để dự đoán kết quả (tr. 1).',
    method: 'Phân loại nghiên cứu theo nguồn dữ liệu, mục tiêu dự đoán và cách đánh giá (tr. 1).',
    results:
      'Phần lớn chỉ dùng dữ liệu một môn, một học kỳ; ít bài kiểm tra trên trường khác (tr. 1).',
    aiNote: 'Bài tổng quan hữu ích để định vị đề tài; cần đọc danh sách tài liệu tham khảo.',
    concepts: ['Phân tích học tập'],
  },
  {
    slug: 'dropout-prediction-sequence-models',
    title: 'Predicting Course Dropout from Weekly Activity with Sequence Models',
    authors: ['Hoa Le', 'David Kim'],
    abstract: [
      'We train recurrent sequence models on weekly activity counts (logins, video time, quiz ' +
        'attempts) from three online courses. By week four the model reaches an AUC of 0.86 for ' +
        'predicting dropout, compared with 0.78 for logistic regression.',
      'All courses in the study are fully online; we do not know how the model behaves for ' +
        'students who mostly attend classes in person.',
    ],
    summary: 'Dự đoán bỏ học từ hoạt động hằng tuần bằng mô hình chuỗi (tr. 1).',
    method: 'Mạng hồi quy trên số lần đăng nhập, thời gian xem video, số lần làm quiz (tr. 1).',
    results: 'AUC 0,86 ở tuần thứ 4, so với 0,78 của hồi quy logistic (tr. 1).',
    aiNote: 'Chỉ có khóa học trực tuyến; chưa rõ áp dụng cho lớp học trực tiếp.',
    concepts: ['Phân tích học tập'],
  },
  {
    slug: 'explainable-grade-prediction',
    title: 'Explainable Grade Prediction for Early Intervention',
    authors: ['Anh Vo', 'Sara Lopez'],
    abstract: [
      'We predict final grades of 2,400 students at one university with gradient boosted trees ' +
        'and explain each prediction with feature attributions. In interviews, 12 teachers said ' +
        'the explanations helped them decide whom to contact first.',
      'The data covers one university and two academic years; we did not study other countries ' +
        'or how students react to being contacted.',
    ],
    summary: 'Dự đoán điểm cuối kỳ có giải thích để hỗ trợ can thiệp sớm (tr. 1).',
    method:
      'Cây tăng cường gradient và giải thích theo từng đặc trưng; phỏng vấn 12 giảng viên (tr. 1).',
    results: 'Giảng viên thấy phần giải thích giúp chọn sinh viên cần liên hệ trước (tr. 1).',
    aiNote: 'Mẫu từ một trường; không có dữ liệu từ châu Á.',
    concepts: ['Mô hình giải thích được', 'Phân tích học tập'],
  },
];

export function samplePaperPdfPath(slug: string): string {
  return `3 Resources/papers/${slug}.pdf`;
}

function paperPdf(paper: SamplePaper): Uint8Array {
  return writeOnePagePdf({
    title: paper.title,
    byline: [
      paper.authors.join(', '),
      'Generated sample data for Second Brain, not a real publication.',
    ],
    paragraphs: paper.abstract,
  });
}

function paperPage(paper: SamplePaper, pdf: Uint8Array, ingestedOn: string): string {
  const hash = createHash('sha256').update(pdf).digest('hex');
  const concepts = paper.concepts.map((concept) => `[[${concept}]]`).join(', ');
  return [
    '---',
    'type: paper',
    `title: "${paper.title}"`,
    `authors: [${paper.authors.join(', ')}]`,
    'year: 2024',
    `source: ${samplePaperPdfPath(paper.slug)}`,
    `source_hash: ${hash}`,
    'pages_covered: 1',
    'verified: false',
    `ingested_at: ${ingestedOn}`,
    `created: ${ingestedOn}`,
    '---',
    '',
    `# ${paper.title}`,
    '',
    `Nguồn: [[${paper.slug}.pdf]]. Khái niệm liên quan: ${concepts}.`,
    '',
    '## Tóm tắt',
    '',
    paper.summary,
    '',
    '## Phương pháp',
    '',
    paper.method,
    '',
    '## Kết quả (theo tác giả)',
    '',
    paper.results,
    '',
    '## Nhận xét của AI',
    '',
    `${paper.aiNote} Trang này là dữ liệu mẫu, chưa được kiểm tra.`,
    '',
  ].join('\n');
}

/** The three PDFs in `3 Resources/papers/` and their summary pages in `wiki/papers/`. */
export function samplePaperFiles(today: string): SampleFile[] {
  const ingestedOn = addDays(today, -2);
  return SAMPLE_PAPERS.flatMap((paper) => {
    const pdf = paperPdf(paper);
    return [
      { path: samplePaperPdfPath(paper.slug), content: pdf },
      { path: `wiki/papers/${paper.slug}.md`, content: paperPage(paper, pdf, ingestedOn) },
    ];
  });
}
