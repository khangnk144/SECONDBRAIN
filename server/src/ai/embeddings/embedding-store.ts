/**
 * `.secondbrain/cache/embeddings.sqlite` (SPEC §4.13 derived cache: deleting it re-embeds).
 * `meta` holds provider, model, dimensions and the schema version (a mismatch means a rebuild);
 * `notes` the revision each note was embedded at; `chunks` one unit vector per chunk of
 * `chunkMarkdown`, with the hash of the text that was embedded (unchanged text reuses its vector).
 * Chunk text itself is not stored: hits are re-read from the note so lines are always current.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { removeDatabaseFiles } from '../../index/index-database.js';
import type { VaultPath } from '../../vault/vault-types.js';

export const EMBEDDINGS_SCHEMA_VERSION = '1';

export interface EmbeddingConfig {
  provider: string;
  model: string;
  dims: number;
}

export interface StoredChunk {
  idx: number;
  startLine: number;
  endLine: number;
  heading: string | null;
  textHash: string;
  vector: Buffer;
}

export interface ChunkRow {
  path: VaultPath;
  idx: number;
  text_hash: string;
  vector: Buffer;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notes(path TEXT PRIMARY KEY, revision TEXT NOT NULL, embedded_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chunks(path TEXT NOT NULL, idx INTEGER NOT NULL, start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL, heading TEXT, text_hash TEXT NOT NULL, vector BLOB NOT NULL,
  PRIMARY KEY(path, idx));
`;

function openChecked(file: string): Database.Database {
  const db = new Database(file);
  try {
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('corrupt');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export class EmbeddingStore {
  private readonly db: Database.Database;

  /** Opens (or creates) the store; a corrupt file is deleted and created again (it is a cache). */
  constructor(readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    let db: Database.Database;
    try {
      db = openChecked(file);
    } catch {
      if (existsSync(file)) removeDatabaseFiles(file);
      db = openChecked(file);
    }
    this.db = db;
  }

  /** The configuration the vectors were made with, or null for an empty or foreign store. */
  config(): EmbeddingConfig | null {
    const rows = this.db.prepare('SELECT key, value FROM meta').all() as {
      key: string;
      value: string;
    }[];
    const meta = new Map(rows.map((row) => [row.key, row.value]));
    if (meta.get('schema') !== EMBEDDINGS_SCHEMA_VERSION) return null;
    const dims = Number(meta.get('dims'));
    const provider = meta.get('provider');
    const model = meta.get('model');
    if (!provider || !model || !Number.isInteger(dims)) return null;
    return { provider, model, dims };
  }

  /** Drops every vector and starts over for `config`. */
  reset(config: EmbeddingConfig): void {
    this.db.transaction(() => {
      this.db.exec('DELETE FROM chunks; DELETE FROM notes; DELETE FROM meta;');
      const insert = this.db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)');
      insert.run('schema', EMBEDDINGS_SCHEMA_VERSION);
      insert.run('provider', config.provider);
      insert.run('model', config.model);
      insert.run('dims', String(config.dims));
    })();
  }

  revisions(): Map<VaultPath, string> {
    const rows = this.db.prepare('SELECT path, revision FROM notes').all() as {
      path: string;
      revision: string;
    }[];
    return new Map(rows.map((row) => [row.path, row.revision]));
  }

  revisionOf(notePath: VaultPath): string | null {
    const row = this.db.prepare('SELECT revision FROM notes WHERE path = ?').get(notePath) as
      { revision: string } | undefined;
    return row?.revision ?? null;
  }

  /** Text hashes that already have a vector for this note. */
  hashesOf(notePath: VaultPath): Set<string> {
    const rows = this.db.prepare('SELECT text_hash FROM chunks WHERE path = ?').all(notePath) as {
      text_hash: string;
    }[];
    return new Set(rows.map((row) => row.text_hash));
  }

  /**
   * Replaces a note's chunks. `vector: null` = reuse the stored vector of the same text hash
   * (looked up before the old rows go).
   */
  writeNote(
    notePath: VaultPath,
    revision: string,
    chunks: (Omit<StoredChunk, 'vector'> & { vector: Buffer | null })[],
    embeddedAt: string,
  ): void {
    this.db.transaction(() => {
      const old = this.db
        .prepare('SELECT text_hash, vector FROM chunks WHERE path = ?')
        .all(notePath) as { text_hash: string; vector: Buffer }[];
      const reusable = new Map(old.map((row) => [row.text_hash, row.vector]));
      this.db.prepare('DELETE FROM chunks WHERE path = ?').run(notePath);
      const insert = this.db.prepare(
        'INSERT INTO chunks(path, idx, start_line, end_line, heading, text_hash, vector) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      for (const chunk of chunks) {
        const vector = chunk.vector ?? reusable.get(chunk.textHash);
        if (!vector) continue; // nothing to reuse after all: the next pass embeds it
        insert.run(
          notePath,
          chunk.idx,
          chunk.startLine,
          chunk.endLine,
          chunk.heading,
          chunk.textHash,
          vector,
        );
      }
      this.db
        .prepare(
          'INSERT INTO notes(path, revision, embedded_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET revision = excluded.revision, embedded_at = excluded.embedded_at',
        )
        .run(notePath, revision, embeddedAt);
    })();
  }

  removeNote(notePath: VaultPath): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM chunks WHERE path = ?').run(notePath);
      this.db.prepare('DELETE FROM notes WHERE path = ?').run(notePath);
    })();
  }

  /** Moves a note's rows (a move keeps its vectors); its revision is cleared so it is re-checked. */
  renameNote(oldPath: VaultPath, newPath: VaultPath): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM chunks WHERE path = ?').run(newPath);
      this.db.prepare('DELETE FROM notes WHERE path = ?').run(newPath);
      this.db.prepare('UPDATE chunks SET path = ? WHERE path = ?').run(newPath, oldPath);
      this.db
        .prepare("UPDATE notes SET path = ?, revision = '' WHERE path = ?")
        .run(newPath, oldPath);
    })();
  }

  hasChunks(): boolean {
    return this.db.prepare('SELECT 1 FROM chunks LIMIT 1').get() !== undefined;
  }

  /** Every chunk row, streamed (the query never loads all vectors at once). */
  iterateChunks(): IterableIterator<ChunkRow> {
    return this.db
      .prepare('SELECT path, idx, text_hash, vector FROM chunks')
      .iterate() as IterableIterator<ChunkRow>;
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // already closed
    }
  }
}
