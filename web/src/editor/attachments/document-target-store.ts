/**
 * "Lưu vào" for dropped documents (SPEC §4.8: a small chooser that remembers the last choice).
 * Requests queue up; `DocumentTargetChooserHost` shows the first one. The choice is remembered per
 * vault and preselected next time; before any choice the folder follows the file type.
 */
import { create } from 'zustand';
import type { DocumentTarget } from '../../lib/api/attachments-types';
import { DOCUMENT_TARGETS } from '../../lib/api/attachments-types';
import { vaultStorage } from '../../lib/vault-storage';
import { guessDocumentTarget } from './attachment-files';

export const DOCUMENT_TARGET_STORAGE_KEY = 'attachments.documentTarget';

export interface DocumentTargetRequest {
  id: number;
  /** File names the choice applies to (one choice for every document of a drop). */
  names: string[];
  initial: DocumentTarget;
  resolve: (target: DocumentTarget | null) => void;
}

interface DocumentTargetState {
  queue: DocumentTargetRequest[];
  /** Settles the request: a target saves it as the remembered choice, null cancels. */
  answer: (id: number, target: DocumentTarget | null) => void;
}

let nextId = 1;

export const useDocumentTargetStore = create<DocumentTargetState>((set, get) => ({
  queue: [],
  answer: (id, target) => {
    const request = get().queue.find((item) => item.id === id);
    if (!request) return;
    set({ queue: get().queue.filter((item) => item.id !== id) });
    if (target) vaultStorage.set(DOCUMENT_TARGET_STORAGE_KEY, target);
    request.resolve(target);
  },
}));

/** Asks where the documents `names` go; null when the person cancelled (Esc). */
export function chooseDocumentTarget(names: string[]): Promise<DocumentTarget | null> {
  return new Promise((resolve) => {
    const request: DocumentTargetRequest = {
      id: nextId++,
      names,
      initial: rememberedTarget() ?? guessDocumentTarget(names[0] ?? ''),
      resolve,
    };
    useDocumentTargetStore.setState((state) => ({ queue: [...state.queue, request] }));
  });
}

function rememberedTarget(): DocumentTarget | null {
  const value = vaultStorage.get<unknown>(DOCUMENT_TARGET_STORAGE_KEY, null);
  return (DOCUMENT_TARGETS as readonly unknown[]).includes(value)
    ? (value as DocumentTarget)
    : null;
}

/** Test helper: cancels every waiting request. */
export function resetDocumentTargetRequests(): void {
  const { queue } = useDocumentTargetStore.getState();
  useDocumentTargetStore.setState({ queue: [] });
  queue.forEach((request) => request.resolve(null));
}
