/**
 * Large seeded notes for performance tests: a ~2 MB lecture-style note mixing every supported
 * construct (plus some verbatim ones), and a note with exactly `blocks` top-level blocks.
 */
import { createRandom, pick, type Random } from './random-markdown';

// prettier-ignore
const SENTENCES = [
  'Hôm nay học về giới hạn và đạo hàm của hàm số một biến.',
  'Đọc kỹ chương 2 trước buổi học sau, nhất là phần ví dụ.',
  'The derivative measures how fast a quantity changes at an instant.',
  'Xem lại [[Giải tích 1#Chương 2|chương hai]] và [[Đại số tuyến tính]].',
  'Ghi chú có **chữ đậm**, *chữ nghiêng*, ~~gạch ngang~~ và `mã nguồn`.',
  'Một liên kết [tài liệu](https://example.com/tai-lieu "Tài liệu") và thẻ #môn/giải-tích.',
  'Hình minh hoạ ![[đồ thị đạo hàm.png]] nằm ở cuối trang.',
  'Công thức quan trọng: đạo hàm của tích bằng *(uv)\' = u\'v + uv\'*.',
];

function paragraph(random: Random): string {
  const count = 1 + Math.floor(random() * 4);
  return Array.from({ length: count }, () => pick(random, SENTENCES)).join(' ');
}

function section(random: Random, index: number): string {
  const parts = [
    `## Phần ${index}: ${pick(random, ['Định nghĩa', 'Ví dụ', 'Bài tập', 'Tóm tắt'])}`,
  ];
  for (let i = 0; i < 3; i += 1) parts.push(paragraph(random));
  parts.push(
    [
      `- [ ] Làm bài ${index}.1 📅 2026-11-${String(1 + (index % 28)).padStart(2, '0')}`,
      `- [x] Đọc mục ${index} ✅ 2026-10-${String(1 + (index % 28)).padStart(2, '0')}`,
      `  - [ ] Ghi chú phụ cho mục ${index} #ôn-tập`,
    ].join('\n'),
  );
  parts.push(`1. Bước một của phần ${index}\n2. Bước hai với [[Bài ${index}]]\n3. Bước ba`);
  if (index % 3 === 0)
    parts.push(
      '| Hàm | Đạo hàm |\n|:----|------:|\n| `x^n` | `n x^(n-1)` |\n| `sin x` | `cos x` |',
    );
  if (index % 4 === 0) parts.push('```js\nconst f = (x) => x * x;\nconsole.log(f(3));\n```');
  if (index % 5 === 0) parts.push(`> Thầy nói: "${pick(random, SENTENCES)}"`);
  if (index % 7 === 0) parts.push("$$\nf'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}\n$$");
  if (index % 11 === 0)
    parts.push('<details>\n<summary>Lời giải</summary>\n\nĐáp án là 42.\n\n</details>');
  return parts.join('\n\n');
}

/** A seeded note of at least `size` characters. */
export function largeNote(size = 2_000_000, seed = 2026): string {
  const random = createRandom(seed);
  const sections = ['---\ntype: lecture\ntags: [giải-tích]\n---\n# Ghi chú cả học kỳ'];
  let length = sections[0]!.length;
  for (let index = 1; length < size; index += 1) {
    const text = section(random, index);
    sections.push(text);
    length += text.length + 2;
  }
  return `${sections.join('\n\n')}\n`;
}

/** A note with exactly `blocks` top-level blocks (paragraphs, headings, lists, code). */
export function manyBlockNote(blocks = 5000, seed = 5000): string {
  const random = createRandom(seed);
  const out: string[] = [];
  for (let i = 0; i < blocks; i += 1) {
    const kind = i % 10;
    if (kind === 0) out.push(`## Mục ${i}`);
    else if (kind === 5)
      out.push(`- [ ] việc ${i} 📅 2026-11-01\n- mục ${i}`.replace('- mục', '- [x] mục'));
    else if (kind === 8) out.push('```\ncode ' + i + '\n```');
    else out.push(`${pick(random, SENTENCES)} (${i})`);
  }
  return `${out.join('\n\n')}\n`;
}
