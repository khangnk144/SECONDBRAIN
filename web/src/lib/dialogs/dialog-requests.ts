/**
 * Promise-based modal dialogs. Callers `await confirmDialog(...)` etc.; the `DialogHost`
 * (features/dialogs) renders the first queued request. All texts arrive translated.
 */
import { create } from 'zustand';
import type { TemplateInfo } from '../api/tree-types';
import type { VaultPath } from '../api/vault-types';

export interface ConfirmDialogOptions {
  title: string;
  body?: string;
  /** Listed below the body (e.g. the notes a rename will rewrite). */
  items?: string[];
  /** Heading of the item list, read by screen readers. */
  itemsLabel?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive action: the confirm button is styled as such and Cancel gets the focus. */
  danger?: boolean;
}

export interface PromptDialogOptions {
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Returns a translated problem, or null when the value can be submitted. */
  validate?: (value: string) => string | null;
}

export interface PickFolderDialogOptions {
  title: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Folders that cannot be chosen (where the item already is, a folder's own subtree). */
  isDisabled?: (path: VaultPath) => boolean;
  /** Offer the vault root (`''`) as a target. */
  includeRoot?: boolean;
}

export interface TemplatePickerOptions {
  templates: TemplateInfo[];
}

/** `template: null` = blank note ("Trống"). */
export interface TemplateChoice {
  template: VaultPath | null;
}

export type DialogRequest =
  | { id: number; kind: 'confirm'; options: ConfirmDialogOptions; resolve: (v: boolean) => void }
  | {
      id: number;
      kind: 'prompt';
      options: PromptDialogOptions;
      resolve: (v: string | null) => void;
    }
  | {
      id: number;
      kind: 'pick-folder';
      options: PickFolderDialogOptions;
      resolve: (v: VaultPath | null) => void;
    }
  | {
      id: number;
      kind: 'template';
      options: TemplatePickerOptions;
      resolve: (v: TemplateChoice | null) => void;
    };

/** `Omit` applied to each member of the union, so `kind` still narrows `options`/`resolve`. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewRequest = DistributiveOmit<DialogRequest, 'id'>;

interface DialogState {
  queue: DialogRequest[];
  open: (request: NewRequest) => void;
  /** Removes the request from the queue (the host already called its `resolve`). */
  close: (id: number) => void;
}

let nextId = 1;

export const useDialogStore = create<DialogState>((set, get) => ({
  queue: [],
  open: (request) =>
    set({ queue: [...get().queue, { ...request, id: nextId++ } as DialogRequest] }),
  close: (id) => set({ queue: get().queue.filter((r) => r.id !== id) }),
}));

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) =>
    useDialogStore.getState().open({ kind: 'confirm', options, resolve }),
  );
}

/** Resolves with the entered text, or null when cancelled. */
export function promptDialog(options: PromptDialogOptions): Promise<string | null> {
  return new Promise((resolve) =>
    useDialogStore.getState().open({ kind: 'prompt', options, resolve }),
  );
}

/** Resolves with the chosen folder path (`''` = vault root), or null when cancelled. */
export function pickFolderDialog(options: PickFolderDialogOptions): Promise<VaultPath | null> {
  return new Promise((resolve) =>
    useDialogStore.getState().open({ kind: 'pick-folder', options, resolve }),
  );
}

export function templatePickerDialog(
  options: TemplatePickerOptions,
): Promise<TemplateChoice | null> {
  return new Promise((resolve) =>
    useDialogStore.getState().open({ kind: 'template', options, resolve }),
  );
}

/** Test helper: cancels everything queued. */
export function resetDialogs(): void {
  for (const request of useDialogStore.getState().queue) {
    if (request.kind === 'confirm') request.resolve(false);
    else request.resolve(null);
  }
  useDialogStore.setState({ queue: [] });
}
