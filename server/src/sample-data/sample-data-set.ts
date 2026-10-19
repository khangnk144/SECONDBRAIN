import type { SampleFile } from './sample-file.js';
import { samplePaperFiles } from './sample-papers.js';
import { sampleStudyNotes } from './sample-study-notes.js';
import { sampleWikiFiles } from './sample-wiki-pages.js';

/**
 * The opt-in sample set of SPEC §10 for a given local date: courses, a project whose tasks
 * cover every urgency colour on the Today strip, a research project with three papers (PDF +
 * summary page), concept and research-gap pages, three Daily notes and two Inbox notes.
 * PDFs come first so the summary pages that link to them resolve as soon as they are indexed.
 */
export function buildSampleDataSet(today: string): SampleFile[] {
  const papers = samplePaperFiles(today);
  const pdfs = papers.filter((file) => file.path.endsWith('.pdf'));
  const pages = papers.filter((file) => !file.path.endsWith('.pdf'));
  return [...pdfs, ...pages, ...sampleWikiFiles(today), ...sampleStudyNotes(today)];
}
