// Wire formats of the local mock AI provider (mock-ai-provider.ts): which app prompt a request
// carries (read from its system prompt, so a test scripts "the intent call" or "the summary"
// rather than the n-th request), the Anthropic Messages SSE events of one streamed answer, and
// deterministic OpenAI-style embeddings in which a small concept table stands for "meaning".

/** The app's prompts, told apart by the first words of their system prompt (vi and en). */
export type PromptKind =
  | 'intent'
  | 'intro'
  | 'answer'
  | 'today'
  | 'summarize'
  | 'improve'
  | 'explain'
  | 'links'
  | 'tags'
  | 'placement'
  | 'other';

const KINDS: [PromptKind, RegExp][] = [
  ['intent', /^You classify one question/],
  ['intro', /lời mở đầu cho một danh sách deadline|opening line for a list of deadlines/],
  ['answer', /^Bạn là trợ lý trong app ghi chú|^You are the assistant inside/],
  ['today', /^Viết đúng một câu ngắn|^Write exactly one short sentence/],
  ['summarize', /^Tóm tắt đoạn văn|^Summarize the passage/],
  ['improve', /^Viết lại đoạn văn|^Rewrite the passage/],
  ['explain', /^Giải thích đoạn văn|^Explain the passage/],
  ['links', /chọn tối đa 5 ghi chú|choose at most 5 that are truly related/],
  ['tags', /^Đề xuất tối đa 5 thẻ|^Suggest at most 5 tags/],
  ['placement', /^Một ghi chú đang nằm trong Inbox|^A note is sitting in the Inbox/],
];

export function promptKind(system: string): PromptKind {
  return KINDS.find(([, test]) => test.test(system))?.[0] ?? 'other';
}

/** One SSE event in Anthropic's format (`event:` line + JSON `data:`). */
const sse = (type: string, data: Record<string, unknown>) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

export function anthropicStart(model: string, inputTokens: number): string {
  return (
    sse('message_start', {
      message: {
        id: 'msg_e2e',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        usage: { input_tokens: inputTokens, output_tokens: 1 },
      },
    }) + sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  );
}

export function anthropicDelta(text: string): string {
  return sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
}

export function anthropicEnd(outputTokens: number): string {
  return (
    sse('content_block_stop', { index: 0 }) +
    sse('message_delta', {
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: outputTokens },
    }) +
    sse('message_stop', {})
  );
}

/** A text cut into a few streamed pieces at word boundaries (at most `parts`). */
export function splitChunks(text: string, parts = 4): string[] {
  const words = text.split(/(?<=\s)/);
  const size = Math.max(1, Math.ceil(words.length / parts));
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(''));
  return out.length > 0 ? out : [''];
}

/** Lower case, no diacritics, đ → d: how the concept table and the word hashes read text. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Concepts that make two texts "mean the same" for the mock: the first dimensions of every
 * vector. "bài về ma trận" and a chapter on "định thức" and "tuyến tính" share the first one.
 */
const CONCEPTS: RegExp[] = [
  /\bma tran\b|\bmatrix|\bdinh thuc\b|\btuyen tinh\b|\bvector\b/,
  /\bxac suat\b|\bprobability\b|\bbayes\b|\bphan phoi\b/,
  /\bdao ham\b|\btich phan\b|\bgiai tich\b|\bcalculus\b/,
];
const CONCEPT_WEIGHT = 8;

function hashWord(word: string): number {
  let h = 2166136261;
  for (let i = 0; i < word.length; i += 1) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic vector of `dims` numbers for `text` (the app normalizes it to unit length). */
export function mockEmbedding(text: string, dims: number): number[] {
  const vector = new Array<number>(dims).fill(0);
  const folded = fold(text);
  CONCEPTS.forEach((concept, i) => {
    if (concept.test(folded)) vector[i]! += CONCEPT_WEIGHT;
  });
  const free = dims - CONCEPTS.length;
  for (const word of folded.split(/[^a-z0-9]+/)) {
    if (word.length < 3) continue;
    vector[CONCEPTS.length + (hashWord(word) % free)]! += 1;
  }
  if (!vector.some((x) => x !== 0)) vector[dims - 1] = 1;
  return vector;
}
