/**
 * A simple word diff between the selected text and its rewrite ("Viết lại cho rõ hơn"): longest
 * common subsequence over words, whitespace kept with the word before it. Long texts (beyond the
 * cell budget) come back as one removed and one added part instead of a slow diff.
 */
export type DiffPart = { kind: 'same' | 'removed' | 'added'; text: string };

const MAX_CELLS = 1_000_000;

/** Words with their trailing whitespace, so joining the parts gives the text back. */
export function splitWords(text: string): string[] {
  return text.match(/\s*\S+\s*/g) ?? (text === '' ? [] : [text]);
}

function push(parts: DiffPart[], kind: DiffPart['kind'], text: string): void {
  const last = parts[parts.length - 1];
  if (last && last.kind === kind) last.text += text;
  else parts.push({ kind, text });
}

const key = (word: string) => word.trim();

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = splitWords(before);
  const b = splitWords(after);
  if (a.length * b.length > MAX_CELLS) {
    const parts: DiffPart[] = [];
    if (before) parts.push({ kind: 'removed', text: before });
    if (after) parts.push({ kind: 'added', text: after });
    return parts;
  }
  // lengths[i][j] = LCS length of a[i..] and b[j..], one flat array.
  const width = b.length + 1;
  const lengths = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        key(a[i]!) === key(b[j]!)
          ? lengths[(i + 1) * width + j + 1]! + 1
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (key(a[i]!) === key(b[j]!)) {
      push(parts, 'same', b[j]!);
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) {
      push(parts, 'removed', a[i]!);
      i += 1;
    } else {
      push(parts, 'added', b[j]!);
      j += 1;
    }
  }
  for (; i < a.length; i += 1) push(parts, 'removed', a[i]!);
  for (; j < b.length; j += 1) push(parts, 'added', b[j]!);
  return parts;
}
