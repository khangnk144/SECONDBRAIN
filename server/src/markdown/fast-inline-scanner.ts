/**
 * Inline pass of the fast scanner over one leaf's text (a paragraph, heading or table cell),
 * following CommonMark + GFM precedence left to right: backslash escapes, code spans, autolinks,
 * raw HTML and GFM autolink literals bind tighter than links; a defined footnote call `[^n]` is
 * never a bracket; `]` closes the nearest `[`/`![` and forms an inline link with a `(…)` tail or
 * a reference with a defined label; a formed link deactivates earlier `[` openers. Emphasis
 * markers only affect the readable text and are dropped with a flanking heuristic.
 */
import {
  CHARACTER_REFERENCE,
  decodeReference,
  isAsciiPunctuation,
} from './character-references.js';
import { isEmphasisMarker } from './emphasis-markers.js';
import { AutolinkLiterals } from './fast-autolink-literal.js';
import { InlinePieces } from './fast-inline-pieces.js';
import { footnoteCallEnd, referenceEnd, type ReferenceSets } from './fast-inline-references.js';
import {
  CodeSpanClosers,
  codeSpanText,
  ForwardFinder,
  InlineSource,
} from './fast-inline-source.js';
import { parseLinkTail } from './fast-link-destination.js';
import { autolinkEnd, inlineHtmlEnd } from './html-syntax.js';
import type { StructureLink, TextSpan } from './note-structure-types.js';
import type { PlainTextBuilder } from './plain-text-builder.js';

const SPECIAL = /[`<[\]!\\&\n*_~]/g;

interface Opener {
  piece: number;
  at: number;
  image: boolean;
  active: boolean;
  links: number;
  excluded: number;
}

export interface InlineOutput {
  excluded: TextSpan[];
  links: StructureLink[];
}

/** Scans the text made of `slices` (absolute `[start, end, …]`, joined by line endings). */
export function scanInline(
  content: string,
  slices: readonly number[],
  out: InlineOutput,
  builder: PlainTextBuilder,
  refs: ReferenceSets,
): void {
  new InlineScan(new InlineSource(content, slices), refs).run(out, builder);
}

class InlineScan {
  private readonly src: string;
  private readonly pieces = new InlinePieces();
  private readonly excluded: TextSpan[] = [];
  private readonly links: StructureLink[] = [];
  private readonly openers: Opener[] = [];
  private readonly literals: AutolinkLiterals;
  private readonly finder: ForwardFinder;
  private readonly codeClosers: CodeSpanClosers;

  constructor(
    private readonly source: InlineSource,
    private readonly refs: ReferenceSets,
  ) {
    this.src = source.text;
    this.literals = new AutolinkLiterals(this.src);
    this.finder = new ForwardFinder(this.src);
    this.codeClosers = new CodeSpanClosers(this.src);
  }

  run(out: InlineOutput, builder: PlainTextBuilder): void {
    const src = this.src;
    let i = 0;
    for (;;) {
      SPECIAL.lastIndex = i;
      const match = SPECIAL.exec(src);
      const at = match ? match.index : src.length;
      const literalEnd =
        this.openers.length > 0 ? this.literals.skipTo(at) : this.literals.crossing(i, at);
      if (literalEnd > 0) {
        this.pieces.text(src.slice(i, literalEnd));
        i = literalEnd;
        continue;
      }
      if (at > i) this.pieces.text(src.slice(i, at));
      if (!match) break;
      i = this.special(at);
      if (this.openers.length === 0 && this.pieces.count > 64) this.pieces.flush(builder);
    }
    this.pieces.flush(builder);
    for (const span of this.excluded) out.excluded.push(span);
    for (const link of this.links) out.links.push(link);
  }

  /** Handles the special character at `at`; returns where scanning continues. */
  private special(at: number): number {
    const src = this.src;
    const code = src.charCodeAt(at);
    if (code === 92) {
      const next = src.charCodeAt(at + 1);
      if (!isAsciiPunctuation(next) && next !== 10) return this.literal('\\', at + 1);
      return this.literal(src[at + 1] as string, at + 2);
    }
    if (code === 96) return this.codeSpan(at);
    if (code === 60) {
      const autolink = autolinkEnd(src, at);
      if (autolink > 0) return this.literal(src.slice(at + 1, autolink - 1), autolink);
      const html = inlineHtmlEnd(src, at, this.finder.find);
      if (html < 0) return this.literal('<', at + 1);
      this.excluded.push({ start: this.source.toAbs(at), end: this.source.toAbs(html) });
      this.pieces.html(src.slice(at, html));
      return html;
    }
    if (code === 38) {
      CHARACTER_REFERENCE.lastIndex = at;
      const reference = CHARACTER_REFERENCE.exec(src);
      if (!reference) return this.literal('&', at + 1);
      return this.literal(decodeReference(reference), at + reference[0].length);
    }
    if (code === 91 || (code === 33 && src.charCodeAt(at + 1) === 91)) return this.openBracket(at);
    if (code === 93) return this.closeBracket(at);
    if (code === 42 || code === 95 || code === 126) {
      let end = at;
      while (src.charCodeAt(end) === code) end += 1;
      if (isEmphasisMarker(src, at, end - at, code)) return end;
      return this.literal(src.slice(at, end), end);
    }
    return this.literal(src[at] as string, at + 1);
  }

  private openBracket(at: number): number {
    const image = this.src.charCodeAt(at) === 33;
    const bracket = image ? at + 1 : at;
    // A defined footnote call is not a bracket (`![^n]` is `!` followed by the call).
    const call = footnoteCallEnd(this.src, bracket, this.refs);
    if (call > 0) {
      if (image) this.pieces.text('!');
      return call;
    }
    const piece = this.pieces.bracket(image ? '![' : '[');
    const { links, excluded } = this;
    this.openers.push({
      piece,
      at,
      image,
      active: true,
      links: links.length,
      excluded: excluded.length,
    });
    return bracket + 1;
  }

  private codeSpan(at: number): number {
    let run = 1;
    while (this.src.charCodeAt(at + run) === 96) run += 1;
    const close = this.codeClosers.closer(at, run);
    if (close === -1) return this.literal(this.src.slice(at, at + run), at + run);
    this.pieces.code(codeSpanText(this.src.slice(at + run, close)));
    this.excluded.push({ start: this.source.toAbs(at), end: this.source.toAbs(close + run) });
    return close + run;
  }

  private closeBracket(at: number): number {
    const opener = this.openers.pop();
    if (opener && opener.active) {
      if (this.src.charCodeAt(at + 1) === 40) {
        const tail = parseLinkTail(this.src, at + 1);
        if (tail) return this.formLink(opener, tail.end, tail.url);
      }
      const labelStart = opener.at + (opener.image ? 2 : 1);
      const end = referenceEnd(this.src, labelStart, at, this.refs);
      if (end > 0) return this.formLink(opener, end, null);
    }
    return this.literal(']', at + 1);
  }

  /** A link or image (`url` null: a reference, which is not reported as a Markdown link). */
  private formLink(opener: Opener, end: number, url: string | null): number {
    // An image keeps only its alt text: links and code inside its label are not nodes.
    if (opener.image) {
      this.links.length = opener.links;
      this.excluded.length = opener.excluded;
      this.pieces.htmlAsTextAfter(opener.piece);
    }
    if (url !== null) {
      this.links.push({ start: this.source.toAbs(opener.at), end: this.source.toAbs(end), url });
    }
    this.pieces.remove(opener.piece);
    if (!opener.image)
      for (const earlier of this.openers) if (!earlier.image) earlier.active = false;
    return end;
  }

  private literal(value: string, next: number): number {
    this.pieces.text(value);
    return next;
  }
}
