/** Typed note endpoints. Paths travel in the query (GET) or the JSON body, never as URL segments. */
import { api } from '../api';
import type {
  CreateNoteRequest,
  CreateNoteResponse,
  FrontmatterPatchRequest,
  FrontmatterPatchResponse,
  LinkMentionRequest,
  MentionsResponse,
  MoveNoteRequest,
  NoteResponse,
  RelinkDryRun,
  RelinkResult,
  RenameNoteRequest,
  SaveNoteRequest,
  SaveNoteResponse,
  TrashResult,
} from './notes-types';
import { withQuery } from './query-string';
import type { VaultPath } from './vault-types';

export function getNote(path: VaultPath): Promise<NoteResponse> {
  return api().get<NoteResponse>(withQuery('/note', { path }));
}

/** Full replace at a revision; 409 CONFLICT carries `currentRevision`/`currentContent`. */
export function putNote(body: SaveNoteRequest): Promise<SaveNoteResponse> {
  return api().request<SaveNoteResponse>('/note', { method: 'PUT', body });
}

/** Creates a note (409 EXISTS unless `unique`). */
export function postNote(body: CreateNoteRequest): Promise<CreateNoteResponse> {
  return api().request<CreateNoteResponse>('/note', { method: 'POST', body });
}

export function patchNoteFrontmatter(
  body: FrontmatterPatchRequest,
): Promise<FrontmatterPatchResponse> {
  return api().request<FrontmatterPatchResponse>('/note/frontmatter', { method: 'PATCH', body });
}

export function postNoteRename(body: RenameNoteRequest): Promise<RelinkResult> {
  return api().request<RelinkResult>('/note/rename', { method: 'POST', body });
}

/** Same planner and revision check as the rename itself; nothing changes. */
export function postNoteRenameDryRun(body: RenameNoteRequest): Promise<RelinkDryRun> {
  return api().request<RelinkDryRun>('/note/rename', {
    method: 'POST',
    body: { ...body, dryRun: true },
  });
}

export function postNoteMove(body: MoveNoteRequest): Promise<RelinkResult> {
  return api().request<RelinkResult>('/note/move', { method: 'POST', body });
}

export function postNoteMoveDryRun(body: MoveNoteRequest): Promise<RelinkDryRun> {
  return api().request<RelinkDryRun>('/note/move', {
    method: 'POST',
    body: { ...body, dryRun: true },
  });
}

/** Moves the files into one trash entry; one expected revision per path. */
export function postNoteTrash(
  paths: VaultPath[],
  expectedRevisions: string[],
): Promise<TrashResult> {
  return api().request<TrashResult>('/note/trash', {
    method: 'POST',
    body: { paths, expectedRevisions },
  });
}

export function getNoteMentions(path: VaultPath): Promise<MentionsResponse> {
  return api().get<MentionsResponse>(withQuery('/note/mentions', { path }));
}

/** Wraps exactly one unlinked mention in `[[…]]` at the given revision. */
export function postLinkMention(body: LinkMentionRequest): Promise<{ revision: string }> {
  return api().request<{ revision: string }>('/note/link-mention', { method: 'POST', body });
}
