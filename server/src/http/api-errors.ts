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
  | 'INTERNAL';

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
