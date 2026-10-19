/**
 * SQLite schema of the derived index (SPEC §4.14) plus the additive tables and columns the
 * indexer needs. Bump INDEX_SCHEMA_VERSION whenever the schema or the meaning of a stored value
 * changes (parser, normalization, classes): a mismatch makes the next open rebuild from files.
 */
import type Database from 'better-sqlite3';

export const INDEX_SCHEMA_VERSION = '2';

const SCHEMA_SQL = `
CREATE TABLE notes(
  id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, title TEXT NOT NULL, title_norm TEXT NOT NULL,
  folder TEXT NOT NULL, class TEXT NOT NULL, type TEXT, status TEXT, deadline TEXT, created TEXT,
  mtime INTEGER NOT NULL, size INTEGER NOT NULL, revision TEXT NOT NULL, frontmatter TEXT,
  word_count INTEGER NOT NULL,
  path_norm TEXT NOT NULL, frontmatter_error TEXT
);
CREATE INDEX notes_mtime ON notes(mtime);

-- target_key: normalized last path segment of the target (".md" stripped). When a file with
-- that name appears or disappears, exactly these links may resolve differently.
CREATE TABLE links(
  from_id INTEGER NOT NULL, target_raw TEXT NOT NULL, to_id INTEGER, heading TEXT,
  line INTEGER NOT NULL, ambiguous INTEGER NOT NULL,
  kind TEXT NOT NULL, raw TEXT NOT NULL, alias TEXT, frontmatter_key TEXT,
  target_key TEXT NOT NULL, to_path TEXT, context TEXT NOT NULL
);
CREATE INDEX links_from ON links(from_id);
CREATE INDEX links_to_path ON links(to_path);
CREATE INDEX links_target_key ON links(target_key);

-- tag_fold: no diacritics at all, for the lenient tag: filter (tag:do-an finds #đồ-án).
CREATE TABLE tags(
  note_id INTEGER NOT NULL, tag TEXT NOT NULL, tag_norm TEXT NOT NULL, tag_fold TEXT NOT NULL
);
CREATE INDEX tags_note ON tags(note_id);
CREATE INDEX tags_norm ON tags(tag_norm);
CREATE INDEX tags_fold ON tags(tag_fold);

CREATE TABLE tasks(
  id INTEGER PRIMARY KEY, note_id INTEGER NOT NULL, line INTEGER NOT NULL, text TEXT NOT NULL,
  done INTEGER NOT NULL, due TEXT, completed TEXT,
  line_text TEXT NOT NULL, invalid_dates TEXT
);
CREATE INDEX tasks_note ON tasks(note_id);

-- Standalone FTS table (not external content): rowid = notes.id, rows only for searchable
-- classes, columns hold normalized text.
CREATE VIRTUAL TABLE notes_fts USING fts5(
  path UNINDEXED, title_norm, body_norm, tokenize='unicode61 remove_diacritics 2'
);

-- Original plain text for snippets (FTS columns are normalized and lose case and diacritics).
CREATE TABLE note_text(note_id INTEGER PRIMARY KEY, plain TEXT NOT NULL);

-- Every non-note file (attachments, PDFs, …): link targets and change detection.
CREATE TABLE files(
  path TEXT PRIMARY KEY, name_key TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL
);

CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
`;

export function createSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run(
    'schema_version',
    INDEX_SCHEMA_VERSION,
  );
}

/** The live database: WAL keeps readers and the writer apart and survives an app crash. */
export function applyLivePragmas(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -32000');
}

/**
 * The database being rebuilt is a throw-away file until the swap, so durability buys nothing:
 * no journal, no fsync. A crash mid-build just leaves a `.building` file that is deleted next time.
 */
export function applyBuildPragmas(db: Database.Database): void {
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.pragma('locking_mode = EXCLUSIVE');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -64000');
}

export function readSchemaVersion(db: Database.Database): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    { value: string } | undefined;
  return row?.value ?? null;
}
