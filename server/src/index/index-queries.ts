/**
 * The read side of the index service: synchronous queries on whichever connection is live right
 * now – the previous database while a rebuild runs, the new one from the moment of the swap.
 */
import type Database from 'better-sqlite3';
import { toLocalDate } from '../lib/local-date.js';
import type { LinkCatalog } from '../markdown/markdown-types.js';
import type { VaultPath } from '../vault/vault-types.js';
import { notesWithOpenItems } from './due-filter.js';
import { createIndexReader, type IndexReader } from './index-reader.js';
import type { SearchQuery, SearchResult } from './index-types.js';
import { createIndexWriter, type IndexWriter } from './index-writer.js';
import { notesLinkingByKeys } from './link-reresolve.js';
import { buildLinkTargets, type LinkTargets } from './link-target-list.js';
import { PathCatalog, pathTargetKey } from './link-targets.js';
import { phraseMatchExpression } from './fts-query.js';
import { runSearch } from './search-service.js';

export interface LiveIndex {
  db: Database.Database;
  reader: IndexReader;
  writer: IndexWriter;
}

export abstract class IndexQueries {
  protected live: LiveIndex | null = null;
  protected readonly catalog = new PathCatalog();

  constructor(protected readonly now: () => Date) {}

  protected attach(db: Database.Database): void {
    this.live = { db, reader: createIndexReader(db), writer: createIndexWriter(db) };
  }

  protected get current(): LiveIndex {
    if (!this.live) throw new Error('The index is not open');
    return this.live;
  }

  getNote = (p: VaultPath) => this.current.reader.getNote(p);
  listNotes = () => this.current.reader.listNotes();
  backlinks = (p: VaultPath) => this.current.reader.backlinks(p);
  outlinks = (p: VaultPath) => this.current.reader.outlinks(p);
  noteTags = (p: VaultPath) => this.current.reader.noteTags(p);
  tags = () => this.current.reader.tags();
  linkCatalog = (): LinkCatalog => this.catalog.get();
  linkingNotes = (p: VaultPath) => this.current.reader.linkingNotes(p);
  notesLinkingByTitleOrPath = (paths: VaultPath[]) =>
    notesLinkingByKeys(this.current.db, paths.map(pathTargetKey)).sort();
  allTasks = () => this.current.reader.allTasks();
  linkTargets = (): LinkTargets =>
    buildLinkTargets(this.current.reader.noteTitles(), this.catalog.get());
  notesContainingPhrase = (text: string): VaultPath[] => {
    const expression = phraseMatchExpression(text);
    return expression === null ? [] : this.current.reader.matchingNotes(expression);
  };
  deadlineRows = () => this.current.reader.deadlineRows();

  search(query: SearchQuery): SearchResult[] {
    const today = () => toLocalDate(this.now());
    return runSearch(
      {
        db: this.current.db,
        duePaths: (due, includeArchive) => notesWithOpenItems(this, today(), due, includeArchive),
      },
      query,
    );
  }
}
