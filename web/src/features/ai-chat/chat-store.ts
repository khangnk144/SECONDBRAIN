/**
 * Conversations of this window (SPEC F33: the server stores none): one thread for the Ask
 * screen, one per note for the note panel's "Hỏi" section. Nothing is persisted; a reload starts
 * fresh. The streaming itself lives in `chat-send.ts`, so a collapsed section or a route change
 * does not cut an answer short.
 */
import { create } from 'zustand';
import type { AssistantTurn, ChatThread, ChatTurn } from './chat-types';

interface ChatStoreState {
  threads: Record<string, ChatThread>;
  /** A request to focus a thread's input (palette command, starters); `seq` makes it repeatable. */
  focus: { threadId: string; seq: number } | null;
}

const EMPTY_THREAD: ChatThread = Object.freeze({ turns: [], draft: '' }) as ChatThread;

export const useChatStore = create<ChatStoreState>(() => ({ threads: {}, focus: null }));

export function getThread(threadId: string): ChatThread {
  return useChatStore.getState().threads[threadId] ?? EMPTY_THREAD;
}

export function useChatThread(threadId: string): ChatThread {
  return useChatStore((state) => state.threads[threadId] ?? EMPTY_THREAD);
}

export function updateThread(threadId: string, update: (thread: ChatThread) => ChatThread): void {
  useChatStore.setState((state) => ({
    threads: { ...state.threads, [threadId]: update(state.threads[threadId] ?? EMPTY_THREAD) },
  }));
}

export function updateAssistantTurn(
  threadId: string,
  turnId: string,
  update: (turn: AssistantTurn) => Partial<AssistantTurn>,
): void {
  updateThread(threadId, (thread) => ({
    ...thread,
    turns: thread.turns.map((turn): ChatTurn =>
      turn.id === turnId && turn.role === 'assistant' ? { ...turn, ...update(turn) } : turn,
    ),
  }));
}

export function setDraft(threadId: string, draft: string): void {
  updateThread(threadId, (thread) => (thread.draft === draft ? thread : { ...thread, draft }));
}

/** Asks the thread's input to take focus (with the caret at the end of the draft). */
export function requestChatFocus(threadId: string): void {
  useChatStore.setState((state) => ({ focus: { threadId, seq: (state.focus?.seq ?? 0) + 1 } }));
}

/** The last answer is still being asked for or streamed. */
export function isThreadBusy(thread: ChatThread): boolean {
  const last = thread.turns.at(-1);
  return last?.role === 'assistant' && (last.status === 'waiting' || last.status === 'streaming');
}

export function resetChatStore(): void {
  useChatStore.setState({ threads: {}, focus: null });
}
