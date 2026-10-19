/**
 * Line diff for the conflict screen ("So sánh"): the disk version against mine, unified, with
 * long unchanged stretches folded. Line endings and the BOM are not shown (they are not lines).
 */
import { diffArrays } from 'diff';

export type DiffRow =
  | {
      kind: 'same' | 'removed' | 'added';
      text: string;
      oldLine: number | null;
      newLine: number | null;
    }
  | { kind: 'folded'; count: number };

/** Lines as shown: no BOM, any line ending; a final line break does not open another line. */
export function displayLines(text: string): string[] {
  const body = text.replace(/^\uFEFF/, '');
  if (body === '') return [];
  const lines = body.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function rowsOf(disk: string, mine: string): Extract<DiffRow, { text: string }>[] {
  const rows: Extract<DiffRow, { text: string }>[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const change of diffArrays(displayLines(disk), displayLines(mine))) {
    for (const text of change.value) {
      if (change.removed) rows.push({ kind: 'removed', text, oldLine: oldLine++, newLine: null });
      else if (change.added) rows.push({ kind: 'added', text, oldLine: null, newLine: newLine++ });
      else rows.push({ kind: 'same', text, oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return rows;
}

/** Unified rows; runs of more than `context * 2` unchanged lines keep `context` on each side. */
export function lineDiff(disk: string, mine: string, context = 3): DiffRow[] {
  const rows = rowsOf(disk, mine);
  const out: DiffRow[] = [];
  let index = 0;
  while (index < rows.length) {
    if (rows[index]?.kind !== 'same') {
      out.push(rows[index] as DiffRow);
      index += 1;
      continue;
    }
    let end = index;
    while (end < rows.length && rows[end]?.kind === 'same') end += 1;
    const keepStart = index === 0 ? 0 : context;
    const keepEnd = end === rows.length ? 0 : context;
    if (end - index > keepStart + keepEnd + 1) {
      out.push(...rows.slice(index, index + keepStart));
      out.push({ kind: 'folded', count: end - index - keepStart - keepEnd });
      out.push(...rows.slice(end - keepEnd, end));
    } else {
      out.push(...rows.slice(index, end));
    }
    index = end;
  }
  return out;
}

export function changeCounts(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.kind === 'added') added += 1;
    else if (row.kind === 'removed') removed += 1;
  }
  return { added, removed };
}
