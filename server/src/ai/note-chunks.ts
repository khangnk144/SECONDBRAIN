/**
 * Splits note text into retrieval chunks (SPEC F33 "Top 12 chunks"): the same function feeds the
 * BM25 chunk ranking and the embedding store, so a citation always points at the same lines.
 * Rules: the YAML block is skipped; a heading starts a new chunk; paragraphs are packed up to
 * CHUNK_TARGET characters; a paragraph longer than CHUNK_MAX is cut on line boundaries (a single
 * huge line is cut on characters). Line numbers are 1-based and inclusive.
 */
import type { NoteChunk } from './ai-types.js';

export const CHUNK_TARGET = 1200;
export const CHUNK_MAX = 2000;

const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}(```|~~~)/;

interface Piece {
  startLine: number;
  endLine: number;
  text: string;
}

/** Number of lines of a leading `---` YAML block (0 when there is none or it never closes). */
function frontmatterLines(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '---' || line === '...') return i + 1;
  }
  return 0;
}

/** Cuts a block longer than CHUNK_MAX into pieces that each stay below it. */
function splitLong(piece: Piece, lines: string[]): Piece[] {
  if (piece.text.length <= CHUNK_MAX) return [piece];
  const out: Piece[] = [];
  let start = piece.startLine;
  let buffer: string[] = [];
  const flush = (end: number) => {
    if (buffer.length > 0) out.push({ startLine: start, endLine: end, text: buffer.join('\n') });
    buffer = [];
  };
  for (let line = piece.startLine; line <= piece.endLine; line++) {
    let text = lines[line - 1] ?? '';
    while (text.length > CHUNK_MAX) {
      flush(line - 1);
      out.push({ startLine: line, endLine: line, text: text.slice(0, CHUNK_MAX) });
      text = text.slice(CHUNK_MAX);
      start = line;
    }
    if (buffer.join('\n').length + text.length + 1 > CHUNK_MAX) {
      flush(line - 1);
      start = line;
    }
    buffer.push(text);
  }
  flush(piece.endLine);
  return out;
}

export function chunkMarkdown(content: string): NoteChunk[] {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const first = frontmatterLines(lines);
  const blocks: (Piece & { heading: string | null; isHeading: boolean })[] = [];
  let heading: string | null = null;
  let current: string[] = [];
  let currentStart = 0;
  let inFence = false;
  const close = (endLine: number) => {
    const text = current.join('\n').trim();
    if (text !== '') {
      blocks.push({ startLine: currentStart, endLine, text, heading, isHeading: false });
    }
    current = [];
  };
  for (let i = first; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;
    if (FENCE.test(line)) inFence = !inFence;
    const match = inFence ? null : HEADING.exec(line);
    if (match) {
      close(lineNo - 1);
      heading = match[1]!.trim() || heading;
      blocks.push({
        startLine: lineNo,
        endLine: lineNo,
        text: line.trim(),
        heading,
        isHeading: true,
      });
      continue;
    }
    if (!inFence && line.trim() === '') {
      close(lineNo - 1);
      continue;
    }
    if (current.length === 0) currentStart = lineNo;
    current.push(line);
  }
  close(lines.length);

  const chunks: NoteChunk[] = [];
  let pack: (typeof blocks)[number][] = [];
  const emit = () => {
    if (pack.length === 0) return;
    const piece: Piece = {
      startLine: pack[0]!.startLine,
      endLine: pack[pack.length - 1]!.endLine,
      text: pack.map((block) => block.text).join('\n\n'),
    };
    const owner = pack.find((block) => !block.isHeading) ?? pack[0]!;
    for (const part of splitLong(piece, lines)) {
      chunks.push({ index: chunks.length, heading: owner.heading, ...part });
    }
    pack = [];
  };
  for (const block of blocks) {
    const size = pack.reduce((sum, b) => sum + b.text.length + 2, 0);
    if (block.isHeading || size + block.text.length > CHUNK_TARGET) emit();
    pack.push(block);
  }
  emit();
  return chunks;
}

/** Chunks of extracted source pages: one or more per page, never across pages. */
export function chunkPages(pages: readonly { page: number; text: string }[]): NoteChunk[] {
  const chunks: NoteChunk[] = [];
  for (const { page, text } of pages) {
    for (const part of chunkMarkdown(text)) {
      chunks.push({ ...part, index: chunks.length, heading: null, page });
    }
  }
  return chunks;
}
