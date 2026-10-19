/**
 * Parse throughput. Cold reindex of the 5,000-note benchmark vault must take ≤ 15 s in total
 * (SPEC §5), so parsing gets ≤ ~7 s of it. Always runs on a synthetic corpus; set
 * `SB_GEN_VAULT=<dir>` (an `npm run gen-vault` output) to measure the real benchmark vault.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNote } from '../../src/markdown/parse-note.js';
import { createRandom } from './helpers/markdown-fuzz.js';

const PARSE_BUDGET_MS = 7000;

function measure(texts: readonly string[]): { ms: number; mb: number } {
  const started = performance.now();
  for (const text of texts) parseNote(text);
  const ms = performance.now() - started;
  const mb = texts.reduce((sum, text) => sum + Buffer.byteLength(text), 0) / 1e6;
  return { ms, mb };
}

const WORDS = [
  'ôn',
  'tập',
  'giải',
  'tích',
  'đạo',
  'hàm',
  'bài',
  'giảng',
  'nghiên',
  'cứu',
  'dữ',
  'liệu',
];

/** About 10 KB with the benchmark vault's density of links, tags, tasks and code. */
function syntheticNote(index: number): string {
  const random = createRandom(index + 1);
  const word = () => WORDS[Math.floor(random() * WORDS.length)] as string;
  const sentence = () => Array.from({ length: 14 }, word).join(' ');
  const parts = [
    `---\ntype: note\ntags: [môn/toán, đồ-án]\ncreated: 2026-10-18\n---\n# Ghi chú ${index}\n`,
  ];
  for (let p = 0; p < 28; p += 1) {
    const link = p % 3 === 0 ? ` Xem [[Bài ${p}|bài ${p}]] và **${word()}**.` : '';
    const tag = p % 7 === 0 ? ` #${word()}` : '';
    parts.push(`${sentence()}. ${sentence()}.${link}${tag}\n`);
  }
  parts.push(
    '## Việc cần làm\n',
    ...Array.from({ length: 5 }, (_, t) => `- [ ] Việc ${t} 📅 2026-10-2${t}\n`),
  );
  parts.push('```js\nconst x = 1; // [[không phải liên kết]]\n```\n');
  return parts.join('\n');
}

function markdownFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '.secondbrain' && entry.name !== '.git') markdownFiles(full, out);
    } else if (entry.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

describe('parseNote throughput', () => {
  it('parses realistic notes far faster than the full CommonMark parse (~1 MB/s)', () => {
    const notes = Array.from({ length: 500 }, (_, i) => syntheticNote(i));
    measure(notes); // warm-up (JIT)
    const { ms, mb } = measure(notes);
    const rate = mb / (ms / 1000);
    console.info(
      `parseNote synthetic: ${mb.toFixed(1)} MB in ${ms.toFixed(0)} ms = ${rate.toFixed(1)} MB/s`,
    );
    expect(rate).toBeGreaterThan(3);
  });

  it.runIf(process.env['SB_GEN_VAULT'])(
    'parses the generated 5k vault within the parse budget',
    () => {
      const files = markdownFiles(process.env['SB_GEN_VAULT'] as string);
      const texts = files.map((file) => readFileSync(file, 'utf8'));
      const { ms, mb } = measure(texts);
      console.info(
        `parseNote gen-vault: ${files.length} notes, ${mb.toFixed(1)} MB in ${ms.toFixed(0)} ms ` +
          `= ${(mb / (ms / 1000)).toFixed(1)} MB/s, ${(files.length / (ms / 1000)).toFixed(0)} notes/s`,
      );
      expect(ms).toBeLessThan(PARSE_BUDGET_MS);
    },
    60000,
  );
});
