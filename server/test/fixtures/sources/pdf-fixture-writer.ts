/**
 * Test-only PDF generator for text extraction: several pages, any Unicode text (each distinct
 * code point gets a one-byte code in a non-embedded Helvetica, mapped back through a ToUnicode
 * CMap, so NFC and NFD Vietnamese both survive), empty pages, an info Title and a fake
 * `/Encrypt` dictionary whose password checks always fail (pdf.js then asks for a password).
 */

export interface FixturePdf {
  /** Lines of text per page; an empty array is a page without any text. */
  pages: string[][];
  title?: string;
  encrypted?: boolean;
}

const FIRST_CODE = 0x21;
const LAST_CODE = 0xff;

const hex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
const utf16Hex = (ch: string) =>
  [...Buffer.from(ch, 'utf16le').swap16()].map((b) => hex2(b)).join('');

/** Assigns byte codes to every code point used (space keeps 0x20). */
function codeTable(pages: string[][]): Map<string, number> {
  const table = new Map<string, number>([[' ', 0x20]]);
  let next = FIRST_CODE;
  for (const line of pages.flat()) {
    for (const ch of line) {
      if (table.has(ch)) continue;
      if (next > LAST_CODE) throw new Error('Too many distinct characters for one fixture font.');
      table.set(ch, next++);
    }
  }
  return table;
}

function toUnicodeCMap(table: Map<string, number>): string {
  const entries = [...table].map(([ch, code]) => `<${hex2(code)}> <${utf16Hex(ch)}>`);
  const chunks: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const part = entries.slice(i, i + 100);
    chunks.push(`${part.length} beginbfchar\n${part.join('\n')}\nendbfchar`);
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<00> <FF>',
    'endcodespacerange',
    ...chunks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

function pageStream(lines: string[], table: Map<string, number>): string {
  if (lines.length === 0) return '';
  const ops = ['BT', '/F1 12 Tf', '16 TL', '56 780 Td'];
  for (const line of lines) {
    const codes = [...line].map((ch) => hex2(table.get(ch)!)).join('');
    ops.push(`<${codes}> Tj T*`);
  }
  ops.push('ET');
  return `${ops.join('\n')}\n`;
}

/** A PDF text string: UTF-16BE with a byte order mark, written as hex (any Unicode title). */
const textString = (text: string) => `<FEFF${[...text].map(utf16Hex).join('')}>`;

export function writeFixturePdf(doc: FixturePdf): Buffer {
  const table = codeTable(doc.pages);
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  const catalog = add('');
  const pagesObj = add('');
  const cmap = toUnicodeCMap(table);
  const cmapObj = add(`<< /Length ${Buffer.byteLength(cmap, 'latin1')} >>\nstream\n${cmap}\nendstream`);
  const font = add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode ${cmapObj} 0 R >>`);
  const kids: number[] = [];
  for (const lines of doc.pages) {
    const stream = pageStream(lines, table);
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] ` +
          `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title ${textString(doc.title ?? '')} /Producer (sb fixture) >>`);
  const encrypt = doc.encrypted
    ? add(`<< /Filter /Standard /V 1 /R 2 /O <${'AB'.repeat(32)}> /U <${'CD'.repeat(32)}> /P -44 >>`)
    : null;

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  const entries = offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}`;
  const extra = encrypt ? ` /Encrypt ${encrypt} 0 R /ID [<${'01'.repeat(16)}> <${'01'.repeat(16)}>]` : '';
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R${extra} >>\n`;
  out += `startxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
