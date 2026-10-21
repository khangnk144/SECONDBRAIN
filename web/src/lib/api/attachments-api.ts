import { ApiError } from '../api-client';
import { apiAuthHeaders } from '../api';
import type { AttachmentTarget, AttachmentUploadResponse } from './attachments-types';

export const ATTACHMENTS_URL = '/api/attachments';

/**
 * Uploads one file (`POST /api/attachments`, multipart: `target` first, then `file`). The shared
 * API client only speaks JSON, so this call builds its own request; it carries the session token
 * like every other call and leaves `Content-Type` to the browser (it adds the multipart boundary).
 * Errors are `ApiError`s in the server's `{error:{code,message,details}}` shape; a network failure
 * rejects with the browser's `TypeError`.
 */
export async function uploadAttachment(
  file: File,
  target: AttachmentTarget,
  options: { signal?: AbortSignal } = {},
): Promise<AttachmentUploadResponse> {
  const form = new FormData();
  form.append('target', target);
  form.append('file', file, file.name);
  // Token and vault id: an upload queued behind a vault switch is refused (409), never misplaced.
  const headers: Record<string, string> = { Accept: 'application/json', ...apiAuthHeaders() };
  const response = await fetch(ATTACHMENTS_URL, {
    method: 'POST',
    headers,
    body: form,
    credentials: 'same-origin',
    signal: options.signal,
  });
  if (!response.ok) throw await uploadError(response);
  return (await response.json()) as AttachmentUploadResponse;
}

async function uploadError(response: Response): Promise<ApiError> {
  const fallback = 'HTTP_' + String(response.status);
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    const details = body.error?.details;
    return new ApiError(
      response.status,
      body.error?.code ?? fallback,
      body.error?.message ?? response.statusText,
      details && typeof details === 'object' && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : undefined,
    );
  } catch {
    return new ApiError(response.status, fallback, response.statusText);
  }
}
