/**
 * The round-trip corpus (`__fixtures__/corpus/*.md`) as strings, loaded through Vite's raw import
 * so stored CRLF, NFD and trailing whitespace bytes are kept. CRLF, BOM and NFD variants are
 * derived here.
 */

const files = import.meta.glob('../__fixtures__/corpus/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface CorpusFile {
  name: string;
  content: string;
}

export const corpus: CorpusFile[] = Object.entries(files)
  .map(([path, content]) => ({ name: path.slice(path.lastIndexOf('/') + 1), content }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function corpusFile(name: string): string {
  const file = corpus.find((entry) => entry.name === name);
  if (!file) throw new Error(`No corpus file ${name}`);
  return file.content;
}

export interface Variant {
  label: string;
  content: string;
}

/** LF, CRLF and BOM (+ the file's own line endings) variants of a corpus file. */
export function lineEndingVariants(content: string): Variant[] {
  const lf = content.replace(/\r\n/g, '\n');
  const crlf = lf.replace(/\n/g, '\r\n');
  return [
    { label: 'LF', content: lf },
    { label: 'CRLF', content: crlf },
    { label: 'BOM', content: `\uFEFF${content}` },
  ];
}

export function allVariants(content: string): Variant[] {
  return [...lineEndingVariants(content), { label: 'NFD', content: content.normalize('NFD') }];
}
