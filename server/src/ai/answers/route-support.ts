/**
 * Small helpers of the AI routes: the log line (route, outcome code, counts, duration – never a
 * question, answer, title or path) and the SSE `error` payload.
 */
import type { AppLogger } from '../../logging/rotating-file-logger.js';
import { AiError } from '../ai-types.js';

/** `ok`, an error code (with the provider's reason), or `aborted`; never a message. */
export function outcomeOf(error: unknown, aborted: boolean): string {
  if (aborted) return 'aborted';
  if (error instanceof AiError) {
    const reason = error.details?.reason;
    return typeof reason === 'string' ? `${error.code}:${reason}` : error.code;
  }
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z_]{2,40}$/.test(code) ? code : 'INTERNAL';
}

/** `logger` is read at each call: the routes' context follows the vault open now. */
export function aiRouteLogger(logger: () => AppLogger) {
  return (route: string, outcome: string, counts: string, started: number) =>
    logger().info(
      `AI ${route} ${outcome}${counts ? ` ${counts}` : ''} ${(performance.now() - started).toFixed(0)}ms`,
    );
}

/** What the client sees when the stream fails after it started (no provider text, no paths). */
export function streamErrorPayload(error: unknown): {
  code: string;
  message: string;
  details?: { reason: string };
} {
  if (error instanceof AiError) {
    // Only the reason code travels (never provider text): the client words its own message.
    const reason = error.details?.reason;
    return typeof reason === 'string'
      ? { code: error.code, message: error.message, details: { reason } }
      : { code: error.code, message: error.message };
  }
  return { code: 'INTERNAL', message: 'The answer stopped unexpectedly. Try again.' };
}
