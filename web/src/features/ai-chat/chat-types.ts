/** One conversation with the AI as the window keeps it (nothing is stored on disk or server). */
import type { AiChatEvent, AiChatSource } from '../../lib/api/ai-types';
import type { AiProvider } from '../../lib/api/settings-types';

export type ChatMeta = Extract<AiChatEvent, { type: 'meta' }>;
export type ChatDone = Extract<AiChatEvent, { type: 'done' }>;

/** Why an answer failed: an API/stream code plus the provider's reason when there is one. */
export interface ChatFailure {
  code: string;
  reason: string | null;
  /** The provider in use when it failed (named in the message). */
  provider: AiProvider | null;
}

export interface UserTurn {
  id: string;
  role: 'user';
  text: string;
}

export interface AssistantTurn {
  id: string;
  role: 'assistant';
  /** The question this turn answers (for "Thử lại" and "Lưu thành ghi chú"). */
  question: string;
  status: 'waiting' | 'streaming' | 'done' | 'error' | 'stopped';
  /** Raw text received so far (shown as plain text until `done`). */
  streamed: string;
  meta: ChatMeta | null;
  /** The validated answer (`done`). */
  done: ChatDone | null;
  failure: ChatFailure | null;
}

export type ChatTurn = UserTurn | AssistantTurn;

/** Answers the server writes itself, with no AI text: nothing found, no items in the range. */
const APP_WRITTEN_NOTICES = ['empty', 'no-items'];

/**
 * Whether what the turn shows was written by the app, not the AI (design.md §7: only AI text is
 * labelled as the AI's): a "nothing found" answer, or a failure before any AI text arrived.
 */
export function isAppWrittenTurn(turn: AssistantTurn): boolean {
  if (turn.status === 'done') {
    return turn.done?.notices.some((notice) => APP_WRITTEN_NOTICES.includes(notice)) === true;
  }
  if (turn.status === 'error') return turn.streamed === '';
  // A text question with no source at all is answered by the app's "nothing found" sentence.
  const meta = turn.meta;
  return turn.status === 'streaming' && meta?.kind === 'text' && meta.sources.length === 0;
}

export interface ChatThread {
  turns: ChatTurn[];
  /** What is typed in the input (kept while the panel section is collapsed). */
  draft: string;
}

export type ChatSource = AiChatSource;

/** The Ask screen has one thread; each note's panel section has its own. */
export const ASK_THREAD = 'ask';

export function noteThreadId(path: string): string {
  return `note:${path}`;
}
