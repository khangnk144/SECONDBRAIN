import { writeOnePagePdf } from './minimal-pdf-writer.js';
import type { SampleFile } from './sample-file.js';

/**
 * Three invented papers for the sample research project. The PDFs say plainly that they are
 * generated sample data so nobody mistakes them for real publications.
 */
export interface SamplePaper {
  slug: string;
  title: string;
  authors: string[];
  abstract: string[];
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
    concepts: ['Mô hình giải thích được', 'Phân tích học tập'],
  },
];

export function samplePaperPdfPath(slug: string): string {
  return `3 Resources/papers/${slug}.pdf`;
}

/** The one-page PDF of a sample paper (deterministic: the same bytes on every call). */
export function samplePaperPdf(paper: SamplePaper): Uint8Array {
  return writeOnePagePdf({
    title: paper.title,
    byline: [
      paper.authors.join(', '),
      'Generated sample data for Second Brain, not a real publication.',
    ],
    paragraphs: paper.abstract,
  });
}

/**
 * The three PDFs in `3 Resources/papers/`. Their summary pages in `wiki/papers/` come with the
 * other wiki pages (`sample-paper-pages.ts`).
 */
export function samplePaperFiles(_today: string): SampleFile[] {
  return SAMPLE_PAPERS.map((paper) => ({
    path: samplePaperPdfPath(paper.slug),
    content: samplePaperPdf(paper),
  }));
}
