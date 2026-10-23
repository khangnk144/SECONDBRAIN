import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { isCalendarDate, toLocalDate } from '../lib/local-date.js';
import { planFrontmatterPatch } from '../markdown/frontmatter-patch.js';
import { splitFrontmatter } from '../markdown/frontmatter.js';
import {
  planTaskLinePatch,
  type TaskLineEdit,
  type TaskLineTarget,
} from '../markdown/task-line-patch.js';
import { revisionOf } from '../vault/vault-errors.js';
import type { PatchPlanner } from '../vault/vault-operation-types.js';
import { isVaultError, VaultError, type VaultPath } from '../vault/vault-types.js';
import { guardNotePath, revisionSchema, vaultPathSchema } from './vault-route-schemas.js';
import { assertNotGeneratedPage } from '../semester/generated-page-registry.js';

interface TaskBody {
  path: string;
  expectedRevision: string;
  line: number;
  expectedText: string;
  done?: boolean;
  due?: string | null;
}

interface RescheduleBody {
  path: string;
  expectedRevision: string;
  target: { kind: 'note' | 'task'; line?: number; expectedText?: string };
  date: string;
}

const lineSchema = { type: 'integer', minimum: 1, maximum: 100_000_000 } as const;
const lineTextSchema = { type: 'string', maxLength: 1_000_000 } as const;

function invalid(reason: string, message: string): VaultError {
  return new VaultError('VALIDATION', message, { reason });
}

function checkDate(date: string): string {
  if (!isCalendarDate(date)) throw invalid('invalid-date', 'The date must be a calendar date.');
  return date;
}

/** A stale `expectedRevision` is a conflict of kind `revision` (the line check is `line-changed`). */
async function withConflictReason<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (isVaultError(error) && error.code === 'CONFLICT' && !error.details?.reason) {
      throw new VaultError('CONFLICT', error.message, { ...error.details, reason: 'revision' });
    }
    throw error;
  }
}

/** The task patch planner; reports the line it wrote through `onLine`. */
function taskPlanner(
  path: VaultPath,
  target: TaskLineTarget,
  edit: TaskLineEdit,
  today: string,
  onLine: (lineText: string) => void = () => undefined,
): PatchPlanner {
  return (content) => {
    try {
      const planned = planTaskLinePatch(content, target, edit, today);
      onLine(planned.lineText);
      return planned.patch ? [planned.patch] : [];
    } catch (error) {
      if (isVaultError(error) && error.details?.reason === 'line-changed') {
        const currentRevision = revisionOf(Buffer.from(content, 'utf8'));
        throw new VaultError('CONFLICT', error.message, {
          path,
          ...error.details,
          currentRevision,
        });
      }
      throw error;
    }
  };
}

/** Only the `deadline:` value changes; a note without that key has no deadline to move. */
function deadlinePlanner(date: string): PatchPlanner {
  return (content) => {
    const data = splitFrontmatter(content).frontmatter.data;
    if (!data || !Object.hasOwn(data, 'deadline')) {
      throw invalid('no-deadline', 'The note has no deadline property.');
    }
    return planFrontmatterPatch(content, { set: { deadline: date } });
  };
}

/**
 * Line-level task edits from the views (SPEC §4.6, §4.10, F9.1, F11.2): a tick or due-date change
 * is one revision-checked line patch; a reschedule (note `deadline:` or task `📅`) is journaled so
 * the 10 s undo toast can revert it through `POST /journal/:id/undo`. Answers come after the
 * index has the change, so Today and the calendar already show it.
 */
export function registerNoteTaskRoutes(app: FastifyInstance, context: AppContext): void {
  app.patch<{ Body: TaskBody }>(
    '/api/note/task',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path', 'expectedRevision', 'line', 'expectedText'],
          properties: {
            path: vaultPathSchema,
            expectedRevision: revisionSchema,
            line: lineSchema,
            expectedText: lineTextSchema,
            done: { type: 'boolean' },
            due: { type: ['string', 'null'], maxLength: 20 },
          },
        },
      },
    },
    async (request) => {
      const { expectedRevision, line, expectedText, done, due } = request.body;
      const path = guardNotePath(request.body.path);
      await assertNotGeneratedPage(context, path); // F25.2
      if ((done === undefined) === (due === undefined)) {
        throw invalid('done-or-due', 'Give either "done" or "due".');
      }
      const edit: TaskLineEdit =
        done !== undefined ? { done } : { due: due === null ? null : checkDate(due!) };
      let lineText = expectedText;
      const today = toLocalDate(context.now());
      const planner = taskPlanner(path, { line, expectedText }, edit, today, (text) => {
        lineText = text;
      });
      const result = await withConflictReason(
        context.vault.patchWith(path, expectedRevision, planner),
      );
      await context.settled();
      return { revision: result.revision, lineText };
    },
  );

  app.post<{ Body: RescheduleBody }>(
    '/api/note/reschedule',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path', 'expectedRevision', 'target', 'date'],
          properties: {
            path: vaultPathSchema,
            expectedRevision: revisionSchema,
            target: {
              type: 'object',
              required: ['kind'],
              properties: {
                kind: { type: 'string', enum: ['note', 'task'] },
                line: lineSchema,
                expectedText: lineTextSchema,
              },
            },
            date: { type: 'string', maxLength: 20 },
          },
        },
      },
    },
    async (request) => {
      const { expectedRevision, target } = request.body;
      const path = guardNotePath(request.body.path);
      await assertNotGeneratedPage(context, path); // F25.2
      const date = checkDate(request.body.date);
      let planner: PatchPlanner;
      // A task target also answers its new line, so the view can act on it again at once.
      let lineText: string | undefined;
      if (target.kind === 'note') {
        planner = deadlinePlanner(date);
      } else {
        if (target.line === undefined || target.expectedText === undefined) {
          throw invalid('task-target', 'A task target needs "line" and "expectedText".');
        }
        const where = { line: target.line, expectedText: target.expectedText };
        lineText = target.expectedText;
        planner = taskPlanner(path, where, { due: date }, toLocalDate(context.now()), (text) => {
          lineText = text;
        });
      }
      try {
        const result = await withConflictReason(
          context.vault.rewriteJournaled(path, expectedRevision, planner, 'reschedule'),
        );
        const answer = { revision: result.revision, journalId: result.journalId };
        return lineText === undefined ? answer : { ...answer, lineText };
      } finally {
        // A failure part-way leaves a pending journal entry the UI must offer to finish or undo.
        await context.settled();
        await context.refreshPendingJournal();
      }
    },
  );
}
