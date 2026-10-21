/** Note endpoints, mirrored from `server/src/api/note-*.ts` and `server/src/vault/vault-types.ts`. */
import type { ContentClass, VaultPath } from './vault-types';

export interface BacklinkRef {
  fromPath: VaultPath;
  fromTitle: string;
  line: number;
  /** The line containing the link, trimmed to ≤ 160 characters around the link. */
  context: string;
  /** [start, end) of the link inside `context`. */
  highlight?: [number, number];
}

export interface OutlinkRef {
  raw: string;
  target: string;
  line: number;
  /** Resolved target path, null for ghost and ambiguous links. */
  toPath: VaultPath | null;
  ambiguous: boolean;
}

/** `GET /api/note?path=` */
export interface NoteResponse {
  path: VaultPath;
  content: string;
  revision: string;
  /** False when the file is not valid UTF-8: `content` is a lossy decode and saving is refused. */
  utf8: boolean;
  /** Epoch milliseconds. */
  mtime: number;
  frontmatter: Record<string, unknown> | null;
  frontmatterError: string | null;
  backlinks: BacklinkRef[];
  outlinks: OutlinkRef[];
  tags: string[];
  class: ContentClass;
}

/** `PUT /api/note`. `conflictCopy`: "keep mine" – the disk version goes to the trash first. */
export interface SaveNoteRequest {
  path: VaultPath;
  content: string;
  expectedRevision: string;
  conflictCopy?: boolean;
}

export interface SaveNoteResponse {
  revision: string;
  /** Present when `conflictCopy` stored the disk version in the trash. */
  trashId?: string;
}

/** `POST /api/note`. `template` and `content` are mutually exclusive. */
export interface CreateNoteRequest {
  path: VaultPath;
  template?: VaultPath;
  title?: string;
  /** Append ` 2`, ` 3`, … when the name is taken; the response names the path used. */
  unique?: boolean;
  /** Exact text to write instead of a template. */
  content?: string;
}

export interface CreateNoteResponse {
  path: VaultPath;
  revision: string;
  /**
   * UTF-16 offset of the template's `{{cursor}}` in the written file; null (or absent) when there
   * is none. The note route passes it on as `&cursor=`.
   */
  cursor?: number | null;
}

/** `PATCH /api/note/frontmatter`; a `null` value in `set` removes the key. */
export interface FrontmatterPatchRequest {
  path: VaultPath;
  expectedRevision: string;
  set?: Record<string, unknown>;
  unset?: string[];
}

export interface FrontmatterPatchResponse {
  revision: string;
  content: string;
}

/** A link that had to change but could not be rewritten so that it still resolves. */
export interface UnresolvableRelink {
  path: VaultPath;
  raw: string;
  line: number;
}

/** Result of a journaled rename/move (note or folder). */
export interface RelinkResult {
  journalId: string;
  /** New path of the renamed/moved note or folder. */
  path: VaultPath;
  revision?: string;
  /** Other notes rewritten by relink (pre-operation paths). */
  affected: VaultPath[];
  skipped?: VaultPath[];
  unresolvable?: UnresolvableRelink[];
}

/** `dryRun: true` answer: what the operation would touch; nothing changed. */
export interface RelinkDryRun {
  dryRun: true;
  path: VaultPath;
  affected: VaultPath[];
  skipped?: VaultPath[];
  unresolvable?: UnresolvableRelink[];
}

export interface RenameNoteRequest {
  path: VaultPath;
  newPath: VaultPath;
  expectedRevision: string;
  relink?: boolean;
}

export interface MoveNoteRequest {
  path: VaultPath;
  folder: VaultPath;
  expectedRevision: string;
  relink?: boolean;
}

export interface TrashResult {
  journalId: string;
  trashId: string;
}

/** One unlinked mention (`GET /api/note/mentions`); offsets are UTF-16 into that note at `revision`. */
export interface MentionRef {
  path: VaultPath;
  title: string;
  revision: string;
  line: number;
  context: string;
  highlight: [number, number];
  start: number;
  end: number;
}

export interface MentionsResponse {
  mentions: MentionRef[];
}

export interface LinkMentionRequest {
  path: VaultPath;
  expectedRevision: string;
  start: number;
  end: number;
  /** Path of the note the mention should link to. */
  target: VaultPath;
}
