import type { FastifyReply } from 'fastify';

/** Error codes shared with the client (see SPEC §9) plus the transport-level ones used by the security layer. */
export type ApiErrorCode =
  | 'NOT_FOUND'
  | 'EXISTS'
  | 'CONFLICT'
  | 'INVALID_PATH'
  | 'VALIDATION'
  | 'WRITE_FAILED'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'MISDIRECTED_REQUEST'
  | 'INTERNAL'
  /** 400: a folder chosen as the vault cannot be opened (`details.reason`). */
  | 'VAULT_UNUSABLE'
  /** 503: a per-vault plugin (reminders, history) is not running for the open vault. */
  | 'UNAVAILABLE'
  /** M6 (F33): see `AiErrorCode` in `ai/ai-types.ts` for statuses. */
  | 'AI_DISABLED'
  | 'AI_NO_KEY'
  | 'AI_BUDGET'
  | 'AI_PROVIDER_ERROR'
  /** 409 (F32.4): a source without usable text cannot be marked as ingested. */
  | 'NEEDS_REVIEW'
  /** 409 (F25.2): the "Học kỳ này" page is written by the app only (`semester/`). */
  | 'GENERATED_PAGE';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}

export function apiErrorBody(code: ApiErrorCode, message: string, details?: unknown): ApiErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export function sendApiError(
  reply: FastifyReply,
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): FastifyReply {
  return reply
    .code(status)
    .type('application/json; charset=utf-8')
    .send(apiErrorBody(code, message, details));
}

/**
 * An API refusal that is not a vault error (vault switch, plugin unavailable…). Thrown from a
 * route; the app's error handler answers `{ error: { code, message, details } }` with `status`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
