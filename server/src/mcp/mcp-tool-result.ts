import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { isApiError } from '../http/api-errors.js';
import { isVaultError } from '../vault/vault-types.js';

/** Codes a tool failure carries: the REST API's codes (SPEC §9), so both surfaces agree. */
export type McpErrorCode =
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'EXISTS'
  | 'INVALID_PATH'
  | 'VALIDATION'
  | 'NEEDS_REVIEW'
  | 'UNAVAILABLE'
  | 'WRITE_FAILED'
  | 'INTERNAL';

/** A refusal decided by an MCP tool itself (permission table, ingest rules, limits). */
export class McpToolError extends Error {
  constructor(
    readonly code: McpErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'McpToolError';
  }
}

export interface ToolFailure {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Success: the same object as JSON text (for clients that read text) and structured content. */
export function toolSuccess(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

/**
 * The failure an error becomes. Conflict details never carry the file content (the model reads
 * the note again); unexpected errors say nothing beyond "internal" (messages can hold paths).
 */
export function toolFailureOf(error: unknown): ToolFailure {
  if (error instanceof McpToolError) {
    return withDetails(error.code, error.message, error.details);
  }
  if (isVaultError(error)) {
    const { currentContent: _content, ...details } = error.details ?? {};
    return withDetails(error.code, error.message, error.details ? details : undefined);
  }
  if (isApiError(error)) return withDetails(error.code, error.message, error.details);
  return { code: 'INTERNAL', message: 'Internal error.' };
}

function withDetails(code: string, message: string, details?: Record<string, unknown>) {
  return details === undefined ? { code, message } : { code, message, details };
}

export function toolFailure(failure: ToolFailure): CallToolResult {
  const data = { ...failure } as Record<string, unknown>;
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
    isError: true,
  };
}
