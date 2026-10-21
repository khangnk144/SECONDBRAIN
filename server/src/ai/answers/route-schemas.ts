/**
 * Strict body schemas of the AI routes (checked with `assertBody`: unknown fields are refused,
 * not silently dropped as Fastify's validator would). Lengths count characters (code points).
 */
import type { BodySchema } from '../../http/strict-body-schema.js';
import type { ChatMessage } from '../ai-types.js';

export const MAX_QUESTION = 4000;
export const MAX_HISTORY_MESSAGES = 10;
export const MAX_HISTORY_CONTENT = 8000;
export const MAX_SEARCH_RESULTS = 20;

export const AI_CHAT_SCHEMA: BodySchema = {
  type: 'object',
  required: ['question'],
  additionalProperties: false,
  properties: {
    question: { type: 'string', minLength: 1, maxLength: MAX_QUESTION },
    history: {
      type: 'array',
      maxItems: MAX_HISTORY_MESSAGES,
      items: {
        type: 'object',
        required: ['role', 'content'],
        additionalProperties: false,
        properties: {
          role: { type: 'string', enum: ['user', 'assistant'] },
          content: { type: 'string', maxLength: MAX_HISTORY_CONTENT },
        },
      },
    },
    notePath: { type: 'string', maxLength: 4096 },
  },
};

export interface ChatBody {
  question: string;
  history?: ChatMessage[];
  notePath?: string;
}

export const AI_SEARCH_SCHEMA: BodySchema = {
  type: 'object',
  required: ['q'],
  additionalProperties: false,
  properties: {
    q: { type: 'string', minLength: 1, maxLength: 500 },
    limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_RESULTS },
  },
};

export interface SearchBody {
  q: string;
  limit?: number;
}

/** An empty JSON object (routes that take no input). */
export const EMPTY_BODY: BodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
};
