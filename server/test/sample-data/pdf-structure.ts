import { expect } from 'vitest';

/** Structural PDF check without a PDF library: header, xref offsets, trailer, stream length. */
export function inspectPdf(bytes: Uint8Array): { objects: number; text: string } {
  const text = Buffer.from(bytes).toString('latin1');
  expect(text.startsWith('%PDF-1.4\n')).toBe(true);
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  const startxref = /startxref\n(\d+)\n%%EOF\n?$/.exec(text);
  expect(startxref).not.toBeNull();
  const xrefOffset = Number(startxref![1]);
  expect(text.slice(xrefOffset, xrefOffset + 5)).toBe('xref\n');
  const header = /^xref\n0 (\d+)\n/.exec(text.slice(xrefOffset));
  expect(header).not.toBeNull();
  const count = Number(header![1]);
  const entriesStart = xrefOffset + header![0].length;
  expect(text.slice(entriesStart, entriesStart + 20)).toBe('0000000000 65535 f \n');
  for (let i = 1; i < count; i += 1) {
    const entry = text.slice(entriesStart + i * 20, entriesStart + (i + 1) * 20);
    expect(entry).toMatch(/^\d{10} 00000 n \n$/);
    const offset = Number(entry.slice(0, 10));
    expect(text.slice(offset, offset + `${i} 0 obj`.length)).toBe(`${i} 0 obj`);
  }
  const trailer = text.slice(entriesStart + count * 20);
  expect(trailer).toMatch(new RegExp(`^trailer\\n<< /Size ${count} /Root 1 0 R /Info \\d+ 0 R >>`));
  const stream = /<< \/Length (\d+) >>\nstream\n/.exec(text);
  expect(stream).not.toBeNull();
  const streamStart = stream!.index + stream![0].length;
  expect(text.slice(streamStart + Number(stream![1]), streamStart + Number(stream![1]) + 9)).toBe(
    'endstream',
  );
  return { objects: count - 1, text };
}
