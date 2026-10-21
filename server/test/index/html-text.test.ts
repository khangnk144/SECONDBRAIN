/**
 * `htmlToText` (clipped web pages in search and as AI sources) runs on the server's event loop:
 * hostile input (an unclosed `<!--` or `<script>` repeated) must take linear time, and the text
 * must stay what the plain regex replacements gave.
 */
import { describe, expect, it } from 'vitest';
import { htmlToText } from '../../src/index/html-text.js';

/** The former implementation (quadratic on unclosed comments, raw-text elements and tags). */
function regexHtmlToText(html: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(
      /<\/?(p|div|br|li|h[1-6]|tr|td|th|section|article|header|footer|blockquote)\b[^>]*>/gi,
      '\n',
    )
    .replace(/<[^>]*>/g, ' ');
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
      if (body.startsWith('#')) {
        const hex = body[1] === 'x' || body[1] === 'X';
        const code = hex ? parseInt(body.slice(2), 16) : Number(body.slice(1));
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      return named[body.toLowerCase()] ?? whole;
    })
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

const TOKENS = [
  '<!--',
  '-->',
  '--',
  '!',
  '<script>',
  '<script type="x">',
  '</script>',
  '</SCRIPT >',
  '<scripts>',
  '<style>',
  '</style>',
  '<noscript>',
  '</noscript>',
  '<template>',
  '</template >',
  '<p>',
  '</p>',
  '<p class="a">',
  '<br/>',
  '<div>',
  '</div>',
  '<h2>',
  '<tr',
  '<thead>',
  '<b>',
  '</b>',
  '<',
  '>',
  'Giải tích',
  'x',
  ' ',
  '  ',
  '\t',
  '\n',
  '\r\n',
  '\r',
  '\u00a0',
  '\u2003',
  '&amp;',
  '&#x41;',
  '&#7843;',
  '&nbsp;',
  '&bogus;',
  '&',
  ';',
];

/** Small deterministic PRNG (mulberry32), so a failure can be reproduced. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('htmlToText', () => {
  it('gives the same text as the regex replacements (fixed and generated pages)', () => {
    const fixed = [
      '<html><head><style>p{color:red}</style><script>var x = "<p>";</script></head>' +
        '<body><h1>Giải tích</h1><p>Chuỗi <b>Fourier</b> &amp; tích phân.</p><!-- ẩn --></body>',
      '<!-- a <!-- b --> c -->',
      '<script>a</script><script>b',
      '<noscript><p>x</p></noscript>y<template>z</template >w',
      '<p<b>x</b>',
      '<b <p>x',
      'a\n \r\n\u00a0\nb\u00a0',
      '<<<>>>',
    ];
    const next = random(20261021);
    const generated = Array.from({ length: 3000 }, () =>
      Array.from(
        { length: Math.floor(next() * 40) },
        () => TOKENS[Math.floor(next() * TOKENS.length)],
      ).join(''),
    );
    for (const html of [...fixed, ...generated]) {
      expect([html, htmlToText(html)]).toEqual([html, regexHtmlToText(html)]);
    }
  });

  it.each([
    ['<!--', '<!--'],
    ['<script>', '<script>'],
    ['<style> and <!--', '<style><!--'],
    ['an unclosed block tag', '<p'],
    ['an unclosed tag', '<'],
    ['a long end tag without >', '</script                '],
    ['no-break spaces without a line break', '\u00a0'],
    ['carriage returns', '\r'],
    ['an entity start without ;', '&#xabcdef0123'],
  ])('1 MB of %s takes well under a second', (_label, unit) => {
    const html = unit.repeat(Math.ceil((1024 * 1024) / unit.length));
    const started = performance.now();
    htmlToText(html);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
