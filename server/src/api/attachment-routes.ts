import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { ATTACHMENT_TARGETS, type AttachmentTarget } from '../attachments/attachment-kinds.js';
import { saveAttachment } from '../attachments/save-attachment.js';
import { sendApiError } from '../http/api-errors.js';
import { isVaultError, VaultError } from '../vault/vault-types.js';

/** SPEC F15: one file of at most 200 MB per request. */
export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024;

export interface AttachmentRouteOptions {
  /** Size limit per file (tests use a small one). */
  maxBytes?: number;
}

/** Multipart limit errors of `@fastify/multipart` and the reason the API reports for each. */
const LIMIT_REASONS: Readonly<Record<string, string>> = {
  FST_REQ_FILE_TOO_LARGE: 'too-large',
  FST_FILES_LIMIT: 'too-many-files',
  FST_PARTS_LIMIT: 'too-many-parts',
  FST_FIELDS_LIMIT: 'too-many-parts',
};

function parseTarget(value: unknown): AttachmentTarget {
  const target = typeof value === 'string' ? value : '';
  if ((ATTACHMENT_TARGETS as readonly string[]).includes(target)) return target as AttachmentTarget;
  throw new VaultError('VALIDATION', 'target must be auto, papers, slides or other.', {
    reason: 'invalid-target',
  });
}

function limitReply(reply: FastifyReply, error: unknown, maxBytes: number): FastifyReply | null {
  const code = (error as { code?: unknown } | null)?.code;
  const reason = typeof code === 'string' ? LIMIT_REASONS[code] : undefined;
  if (!reason) return null;
  const message =
    reason === 'too-large'
      ? `The file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`
      : 'Send one file per request.';
  return sendApiError(reply, 413, 'VALIDATION', message, { reason, maxBytes });
}

/**
 * `POST /api/attachments` (SPEC §9, F15.1): multipart with an optional `target` field
 * (`auto` | `papers` | `slides` | `other`, default `auto`) and one file part. The multipart parser
 * lives in its own plugin scope, so no other route accepts multipart bodies and the app's JSON
 * body limit is unchanged. The file is buffered (≤ the limit) and saved through the vault
 * service; 201 `{ path, name, kind, link }` once the index knows the file.
 */
export function registerAttachmentRoutes(
  app: FastifyInstance,
  context: AppContext,
  options: AttachmentRouteOptions = {},
): void {
  const maxBytes = options.maxBytes ?? MAX_ATTACHMENT_BYTES;
  void app.register(async (scope) => {
    await scope.register(fastifyMultipart, {
      // Keep the browser's full name: the name rules replace separators instead of guessing.
      preservePath: true,
      throwFileSizeLimit: true,
      limits: { files: 1, fileSize: maxBytes, fields: 8, parts: 9, fieldSize: 1024 },
    });
    scope.post('/api/attachments', async (request, reply) => {
      if (!request.isMultipart()) {
        throw new VaultError('VALIDATION', 'Send the file as multipart/form-data.', {
          reason: 'not-multipart',
        });
      }
      let target: AttachmentTarget = 'auto';
      let file: { clientName: string; bytes: Buffer } | null = null;
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            file = { clientName: part.filename ?? '', bytes: await part.toBuffer() };
          } else if (part.fieldname === 'target') {
            target = parseTarget(part.value);
          }
        }
      } catch (error) {
        const limited = limitReply(reply, error, maxBytes);
        if (limited) return limited;
        if (isVaultError(error) || (error as { statusCode?: unknown }).statusCode) throw error;
        // Busboy's own parse errors (no boundary, truncated body) are a bad request, not a crash.
        throw new VaultError('VALIDATION', 'The multipart body could not be read.', {
          reason: 'bad-multipart',
        });
      }
      if (!file) {
        throw new VaultError('VALIDATION', 'The request has no file.', { reason: 'no-file' });
      }
      const saved = await saveAttachment(context, { ...file, target });
      return reply.code(201).send(saved);
    });
  });
}
