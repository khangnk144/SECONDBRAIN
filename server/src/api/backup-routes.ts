import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import type { VaultHost } from '../app-context/vault-host.js';
import { BackupRefusedError, refuse, toValidationError } from '../backup/backup-errors.js';
import { buildBackupFile, sendableBackup } from '../backup/backup-export-file.js';
import { backupFileName } from '../backup/backup-file-name.js';
import {
  checkRestoreTarget,
  createRestoreWorkDir,
  giveRestoredVaultNewId,
  moveIntoPlace,
  readRestoredVaultId,
} from '../backup/restore-target.js';
import { extractZipArchive } from '../backup/zip-archive-extract.js';
import { releaseFromGate } from '../http/register-request-gate.js';

/** The uploaded backup: one file, fields first (SPEC F18.5). */
const RESTORE_UPLOAD_LIMITS = {
  fileSize: 2 * 1024 ** 3,
  files: 1,
  fields: 4,
  parts: 6,
  fieldSize: 8 * 1024,
  headerPairs: 100,
};

const FORM_ERRORS = new Set([
  'FST_FILES_LIMIT',
  'FST_PARTS_LIMIT',
  'FST_FIELDS_LIMIT',
  'FST_PROTO_VIOLATION',
]);

function mapRestoreError(error: unknown): unknown {
  if (error instanceof BackupRefusedError) return toValidationError(error);
  const code = (error as { code?: string } | null)?.code ?? '';
  if (code === 'FST_REQ_FILE_TOO_LARGE') return toValidationError(refuse('too-large'));
  if (FORM_ERRORS.has(code)) return toValidationError(refuse('bad-form'));
  return error;
}

async function discard(stream: Readable): Promise<void> {
  // Read the rest of the upload so the client gets the answer instead of a broken connection.
  for await (const chunk of stream) void chunk;
}

/**
 * "Xuất bản sao lưu…" and "Khôi phục thử…" (SPEC F18). Export builds a zip of the open vault
 * (never anything outside it) while no write can interleave, then streams the finished file;
 * `x-sb-backup-unreadable` counts every file left out. Restore extracts an uploaded zip into a
 * new or empty folder outside the vault through a temp sibling folder, then optionally opens it
 * through the host.
 */
export async function registerBackupRoutes(app: FastifyInstance, host: VaultHost): Promise<void> {
  const { context } = host;

  app.post('/api/backup/export', async (_request, reply) => {
    const { vault } = context; // one vault for the whole export, even if a switch follows
    await context.settled(); // the zip matches what the index has seen
    let built;
    try {
      built = await buildBackupFile(vault);
    } catch (error) {
      throw error instanceof BackupRefusedError ? toValidationError(error) : error;
    }
    context.logger.info(
      `Backup exported: ${built.entries} entries, ${built.unreadable} unreadable.`,
    );
    const name = backupFileName(context.now());
    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="${name}"; filename*=UTF-8''${name}`)
      .header('content-length', String(built.size))
      .header('cache-control', 'no-store')
      .header('x-sb-backup-unreadable', String(built.unreadable))
      .send(sendableBackup(built));
  });

  async function restoreUpload(file: Readable & { truncated?: boolean }, target: unknown) {
    const checked = await checkRestoreTarget(target, {
      vaultRoot: context.vault.root,
      protectedDirs: host.protectedDirs,
    });
    const work = await createRestoreWorkDir(checked.parent);
    try {
      const zipFile = path.join(work, 'backup.zip');
      await pipeline(file, createWriteStream(zipFile, { flags: 'wx' }));
      if (file.truncated) throw refuse('too-large');
      const extracted = path.join(work, 'vault');
      await mkdir(extracted);
      const { files } = await extractZipArchive(zipFile, extracted);
      // Before the copy is in place (and long before it can be opened): see giveRestoredVaultNewId.
      await giveRestoredVaultNewId(extracted);
      await moveIntoPlace(extracted, checked);
      context.logger.info(`Backup restored: ${files} files.`);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
    return checked.folder;
  }

  // Multipart only for this route: the rest of the API keeps its JSON body limit.
  await app.register(async (scope) => {
    await scope.register(fastifyMultipart, {
      limits: RESTORE_UPLOAD_LIMITS,
      throwFileSizeLimit: true,
    });
    scope.post('/api/backup/restore', async (request, reply) => {
      if (!request.isMultipart()) throw toValidationError(refuse('bad-form'));
      const fields: Record<string, string> = {};
      let restored: string | null = null;
      let open = true;
      try {
        for await (const part of request.parts()) {
          if (part.type === 'field') {
            if (restored === null && typeof part.value === 'string')
              fields[part.fieldname] = part.value;
            continue;
          }
          const formOk =
            restored === null &&
            part.fieldname === 'file' &&
            fields.target !== undefined &&
            ['true', 'false', undefined].includes(fields.open);
          if (!formOk) {
            await discard(part.file);
            throw refuse('bad-form');
          }
          open = fields.open !== 'false';
          try {
            restored = await restoreUpload(part.file, fields.target);
          } catch (error) {
            if (!part.file.readableEnded) await discard(part.file).catch(() => undefined);
            throw error;
          }
        }
      } catch (error) {
        throw mapRestoreError(error);
      }
      if (restored === null) throw toValidationError(refuse('bad-form'));
      if (!open)
        return reply
          .code(201)
          .send({ path: restored, vaultId: await readRestoredVaultId(restored) });
      releaseFromGate(request); // the switch must not wait for this very request
      const switched = await host.switchTo(restored);
      return reply.code(201).send({ path: switched.path, vaultId: switched.vaultId });
    });
  });
}
