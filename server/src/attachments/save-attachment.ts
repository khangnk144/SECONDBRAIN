/**
 * Saves one dropped file into the vault (SPEC §4.8, F15.1) and builds the link the editor
 * inserts. The file is written through `VaultService.create`, which never overwrites: it is the
 * last uniqueness gate (another program may have created the name meanwhile → next suffix).
 */
import type { AppContext } from '../app-context/create-app-context.js';
import { SerialQueue } from '../index/serial-queue.js';
import { isVaultError, type VaultService, type WriteResult } from '../vault/vault-types.js';
import { attachmentFileName } from './attachment-file-name.js';
import { attachmentFolder, fileKindOf, type AttachmentTarget } from './attachment-kinds.js';
import {
  isNameTaken,
  nameCandidates,
  nameLinksUniquely,
  takenNameKeys,
} from './vault-unique-names.js';

export interface SavedAttachment {
  path: string;
  name: string;
  kind: 'image' | 'pdf' | 'document' | 'other';
  /** `![[name]]` for images, `[[name]]` otherwise; the path form when the name is not unique. */
  link: string;
}

export interface AttachmentInput {
  /** The name the browser sent (may be NFD, contain separators or be empty). */
  clientName: string;
  bytes: Uint8Array;
  target: AttachmentTarget;
}

// Uploads of one vault run one at a time: two drops of `image.png` landing in different month
// folders would otherwise both see the name as free.
const queues = new WeakMap<VaultService, SerialQueue>();

function queueFor(vault: VaultService): SerialQueue {
  let queue = queues.get(vault);
  if (!queue) {
    queue = new SerialQueue();
    queues.set(vault, queue);
  }
  return queue;
}

async function createWithFreeName(
  context: AppContext,
  folder: string,
  name: string,
  bytes: Uint8Array,
): Promise<WriteResult> {
  const taken = takenNameKeys(context.index.linkCatalog());
  let lastClash: unknown = null;
  for (const candidate of nameCandidates(name)) {
    if (isNameTaken(taken, candidate)) continue;
    try {
      return await context.vault.create(`${folder}/${candidate}`, bytes);
    } catch (error) {
      // Taken on disk but not (yet) in the index – e.g. a file the watcher has not reported.
      if (!(isVaultError(error) && error.code === 'EXISTS')) throw error;
      lastClash = error;
    }
  }
  throw lastClash ?? new Error('No free attachment name');
}

export function saveAttachment(
  context: AppContext,
  input: AttachmentInput,
): Promise<SavedAttachment> {
  const { vault } = context;
  return queueFor(vault).enqueue(async () => {
    const now = context.now();
    const baseName = attachmentFileName(input.clientName, now);
    const folder = attachmentFolder(baseName, input.target, now);
    // Read-your-writes: the catalog must already hold every file this process saved.
    await context.settled();
    const written = await createWithFreeName(context, folder, baseName, input.bytes);
    await context.settled();
    const name = written.path.slice(written.path.lastIndexOf('/') + 1);
    const fileKind = fileKindOf(name);
    const linkTarget = nameLinksUniquely(context.index.linkCatalog(), written.path)
      ? name
      : written.path;
    return {
      path: written.path,
      name,
      kind: fileKind === 'note' ? 'document' : fileKind,
      link: fileKind === 'image' ? `![[${linkTarget}]]` : `[[${linkTarget}]]`,
    };
  });
}
