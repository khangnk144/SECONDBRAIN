/**
 * Builds the readable text of a block for search and snippets. Wikilinks contribute their
 * alias (or target) instead of the `[[…]]` syntax, but only in ordinary text: code keeps its
 * content verbatim, matching the rule that links inside code are not links.
 */
import { substituteWikilinks } from './wikilink-scan.js';

export class PlainTextBuilder {
  private pending = '';
  private block = '';

  text(value: string): void {
    this.pending += value;
  }

  code(value: string): void {
    this.flush();
    this.block += value;
  }

  /** Returns the finished block and starts a new one. */
  take(): string {
    this.flush();
    const block = this.block;
    this.block = '';
    return block;
  }

  private flush(): void {
    if (this.pending !== '') this.block += substituteWikilinks(this.pending);
    this.pending = '';
  }
}
