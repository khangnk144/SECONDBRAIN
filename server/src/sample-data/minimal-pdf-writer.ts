/**
 * Writes a valid one-page PDF 1.4 (A4, Helvetica) without any dependency: catalog, page tree,
 * one page, two standard fonts, one content stream, an info dictionary and an xref table with
 * exact byte offsets. Only printable ASCII is supported (the standard 14 fonts need no
 * embedding for it), which is all the sample papers need.
 */

export interface OnePagePdf {
  title: string;
  /** Lines under the title (authors, venue…), small print. */
  byline?: string[];
  /** Paragraphs of body text, wrapped to the page width. */
  paragraphs: string[];
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 56;
/** Helvetica averages about half an em per character; 11 pt text → ~88 characters per line. */
const BODY_SIZE = 11;
const BODY_CHARS_PER_LINE = Math.floor((PAGE_WIDTH - 2 * MARGIN) / (BODY_SIZE * 0.5));
const TITLE_SIZE = 18;
const TITLE_CHARS_PER_LINE = Math.floor((PAGE_WIDTH - 2 * MARGIN) / (TITLE_SIZE * 0.55));

function assertAscii(text: string): void {
  if (!/^[\x20-\x7e]*$/.test(text)) {
    throw new Error('The minimal PDF writer supports printable ASCII text only.');
  }
}

/** Escapes a PDF literal string: backslash and parentheses. */
function pdfString(text: string): string {
  assertAscii(text);
  return `(${text.replace(/[\\()]/g, (char) => `\\${char}`)})`;
}

export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line = `${line} ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

function contentStream(doc: OnePagePdf): string {
  const ops: string[] = ['BT', `${MARGIN} ${PAGE_HEIGHT - MARGIN - TITLE_SIZE} Td`];
  ops.push(`/F2 ${TITLE_SIZE} Tf`, `${TITLE_SIZE + 6} TL`);
  for (const line of wrapText(doc.title, TITLE_CHARS_PER_LINE))
    ops.push(`${pdfString(line)} Tj T*`);
  ops.push(`/F1 ${BODY_SIZE - 1} Tf`, `${BODY_SIZE + 3} TL`);
  for (const line of doc.byline ?? []) ops.push(`${pdfString(line)} Tj T*`);
  ops.push(`/F1 ${BODY_SIZE} Tf`, `${BODY_SIZE + 5} TL`);
  for (const paragraph of doc.paragraphs) {
    ops.push('T*');
    for (const line of wrapText(paragraph, BODY_CHARS_PER_LINE)) {
      ops.push(`${pdfString(line)} Tj T*`);
    }
  }
  ops.push('ET');
  return `${ops.join('\n')}\n`;
}

/** Builds the PDF bytes. Deterministic: the same input always gives the same file. */
export function writeOnePagePdf(doc: OnePagePdf): Uint8Array {
  const stream = contentStream(doc);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`,
    `<< /Title ${pdfString(doc.title)} /Producer (Second Brain sample data) >>`,
  ];

  // The second header line holds bytes > 127 so tools treat the file as binary (PDF 1.4 §3.4.1).
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  // Every xref entry is exactly 20 bytes: 10-digit offset, 5-digit generation, type, space + LF.
  const entries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries.join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\n`;
  out += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
