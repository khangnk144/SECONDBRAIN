/**
 * Asking: one streamed `POST /ai/chat` per question, its events written into the thread as they
 * arrive. Nothing is sent while the status says AI is not ready (SPEC F33: no key, AI off, no
 * consent or the limit reached → no request at all). "Dừng" aborts the request, which also
 * cancels the provider call on the server.
 */
import { streamAiChat } from '../../lib/api/ai-api';
import type { AiChatEvent } from '../../lib/api/ai-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { useAiStatusStore } from '../../lib/ai-status-store';
import { failureFromError, failureFromEvent, isReadinessFailure } from './chat-errors';
import { chatHistory } from './chat-history';
import { getThread, updateAssistantTurn, updateThread } from './chat-store';
import type { AssistantTurn, ChatFailure } from './chat-types';

/** The server accepts questions of 1–4,000 characters. */
export const MAX_QUESTION_LENGTH = 4_000;

const controllers = new Map<string, AbortController>();
let nextTurn = 1;

export interface AskOptions {
  /** The note the question is about (note panel); the server ignores it when out of AI scope. */
  notePath?: VaultPath | null;
}

/** Whether a question may go out now; an unknown status is asked for first. */
async function mayAsk(): Promise<boolean> {
  let { status } = useAiStatusStore.getState();
  if (!status) {
    await useAiStatusStore.getState().load();
    status = useAiStatusStore.getState().status;
  }
  // Unknown (server unreachable): the request itself fails and says so; nothing leaves the app.
  return status === null || status.ready;
}

function apply(threadId: string, turnId: string, event: AiChatEvent): ChatFailure | null {
  switch (event.type) {
    case 'meta':
      updateAssistantTurn(threadId, turnId, () => ({ meta: event, status: 'streaming' }));
      return null;
    case 'delta':
      updateAssistantTurn(threadId, turnId, (turn) => ({
        streamed: turn.streamed + event.text,
        status: 'streaming',
      }));
      return null;
    case 'done':
      updateAssistantTurn(threadId, turnId, () => ({ done: event, status: 'done' }));
      return null;
    case 'error': {
      const provider = useAiStatusStore.getState().status?.provider ?? null;
      return failureFromEvent(event, provider);
    }
  }
}

function fail(threadId: string, turnId: string, failure: ChatFailure): void {
  updateAssistantTurn(threadId, turnId, () => ({ status: 'error', failure }));
  // AI was turned off, the key removed or the limit reached since the status was read.
  if (isReadinessFailure(failure)) void useAiStatusStore.getState().load();
}

/** Resolves false when nothing was asked (empty, too long, busy, or AI not ready). */
export async function askQuestion(
  threadId: string,
  question: string,
  options: AskOptions = {},
): Promise<boolean> {
  const text = question.trim();
  if (text === '' || [...text].length > MAX_QUESTION_LENGTH || controllers.has(threadId)) {
    return false;
  }
  const controller = new AbortController();
  controllers.set(threadId, controller);
  try {
    if (!(await mayAsk())) return false;
    const history = chatHistory(getThread(threadId).turns);
    const id = String(nextTurn++);
    const turnId = `a${id}`;
    const answer: AssistantTurn = {
      id: turnId,
      role: 'assistant',
      question: text,
      status: 'waiting',
      streamed: '',
      meta: null,
      done: null,
      failure: null,
    };
    updateThread(threadId, (thread) => ({
      ...thread,
      turns: [...thread.turns, { id: `u${id}`, role: 'user', text }, answer],
    }));
    await streamInto(threadId, turnId, controller, {
      question: text,
      history: history.length > 0 ? history : undefined,
      notePath: options.notePath ?? undefined,
    });
    return true;
  } finally {
    if (controllers.get(threadId) === controller) controllers.delete(threadId);
  }
}

async function streamInto(
  threadId: string,
  turnId: string,
  controller: AbortController,
  request: Parameters<typeof streamAiChat>[0],
): Promise<void> {
  const provider = () => useAiStatusStore.getState().status?.provider ?? null;
  let ended = false;
  try {
    for await (const event of streamAiChat(request, controller.signal)) {
      const failure = apply(threadId, turnId, event);
      if (failure) fail(threadId, turnId, failure);
      if (event.type === 'done' || event.type === 'error') ended = true;
    }
    if (controller.signal.aborted) stopped(threadId, turnId);
    else if (!ended) fail(threadId, turnId, { code: 'INCOMPLETE', reason: null, provider: null });
  } catch (error) {
    if (controller.signal.aborted) stopped(threadId, turnId);
    else fail(threadId, turnId, failureFromError(error, provider()));
  }
}

function stopped(threadId: string, turnId: string): void {
  updateAssistantTurn(threadId, turnId, (turn) =>
    turn.status === 'done' || turn.status === 'error' ? {} : { status: 'stopped' },
  );
}

/** "Dừng": cancels the answer being streamed (the text so far stays, marked as stopped). */
export function stopAnswer(threadId: string): void {
  controllers.get(threadId)?.abort();
}

/** "Thử lại": asks the failed question again, in place of the failed turn. */
export function retryAnswer(threadId: string, turnId: string, options: AskOptions = {}): void {
  const thread = getThread(threadId);
  const index = thread.turns.findIndex((turn) => turn.id === turnId);
  const turn = thread.turns[index];
  if (!turn || turn.role !== 'assistant' || controllers.has(threadId)) return;
  const { status } = useAiStatusStore.getState();
  if (status && !status.ready) return;
  const start = thread.turns[index - 1]?.role === 'user' ? index - 1 : index;
  updateThread(threadId, (current) => ({
    ...current,
    turns: current.turns.filter((_, at) => at < start || at > index),
  }));
  void askQuestion(threadId, turn.question, options);
}

/** "Cuộc trò chuyện mới": stops any answer and forgets the turns (the draft stays). */
export function newConversation(threadId: string): void {
  stopAnswer(threadId);
  controllers.delete(threadId);
  updateThread(threadId, (thread) => ({ ...thread, turns: [] }));
}

/** Tests: abort everything in flight. */
export function resetChatSending(): void {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
}
