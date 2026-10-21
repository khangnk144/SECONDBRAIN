/**
 * The PDF on screen: bytes fetched with the token, opened with pdf.js, kept current. A change of
 * the file on disk (`note:changed`/`note:created` for this path, a reconnect) loads it again and
 * swaps it in only once the new version opened, so the page and zoom stay; `note:deleted` shows
 * the missing state at once.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError } from '../../lib/api-client';
import { fetchVaultFileBytes } from '../../lib/api/files-api';
import type { VaultPath } from '../../lib/api/vault-types';
import { samePath } from '../../lib/vault-paths';
import { useServerEvent } from '../../lib/ws/use-server-event';
import { documentParameters, loadPdfJs, type PDFDocumentProxy } from './pdf-js';

export type PdfDocumentState =
  | { status: 'loading' }
  /** `version` grows with every reload, so pages render the new document. */
  | { status: 'ready'; doc: PDFDocumentProxy; version: number }
  | { status: 'missing' }
  /** Not a readable PDF (`invalid`) or protected by a password. */
  | { status: 'broken'; reason: 'invalid' | 'password' }
  /** The server could not be reached or answered with an error: retry. */
  | { status: 'error'; offline: boolean };

function brokenReason(error: unknown): 'invalid' | 'password' | null {
  const name = error instanceof Error ? error.name : '';
  if (name === 'PasswordException') return 'password';
  if (name === 'InvalidPDFException' || name === 'UnknownErrorException') return 'invalid';
  return null;
}

export function usePdfDocument(path: VaultPath): {
  state: PdfDocumentState;
  reload: () => void;
} {
  const [state, setState] = useState<PdfDocumentState>({ status: 'loading' });
  const seq = useRef(0);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const versionRef = useRef(0);

  const replaceDoc = useCallback((next: PDFDocumentProxy | null) => {
    const previous = docRef.current;
    docRef.current = next;
    if (previous && previous !== next) void previous.loadingTask.destroy();
  }, []);

  const load = useCallback(
    async (target: VaultPath, options: { keepOnScreen: boolean }) => {
      const mine = ++seq.current;
      if (!options.keepOnScreen) setState({ status: 'loading' });
      let next: PdfDocumentState;
      try {
        const [bytes, pdfjs] = await Promise.all([fetchVaultFileBytes(target), loadPdfJs()]);
        if (mine !== seq.current) return;
        const task = pdfjs.getDocument(documentParameters(bytes));
        const doc = await task.promise;
        if (mine !== seq.current) {
          void task.destroy();
          return;
        }
        replaceDoc(doc);
        versionRef.current += 1;
        next = { status: 'ready', doc, version: versionRef.current };
      } catch (error) {
        if (mine !== seq.current) return;
        const reason = brokenReason(error);
        if (isApiError(error, 'NOT_FOUND')) next = { status: 'missing' };
        else if (reason) next = { status: 'broken', reason };
        else next = { status: 'error', offline: error instanceof TypeError };
        if (next.status !== 'error' || !options.keepOnScreen) replaceDoc(null);
        // A failed background reload keeps the document that is on screen.
        if (next.status === 'error' && options.keepOnScreen && docRef.current) return;
      }
      setState(next);
    },
    [replaceDoc],
  );

  useEffect(() => {
    void load(path, { keepOnScreen: false });
  }, [path, load]);

  useEffect(
    () => () => {
      seq.current += 1;
      replaceDoc(null);
    },
    [replaceDoc],
  );

  const pathRef = useRef(path);
  useEffect(() => {
    pathRef.current = path;
  });
  const refresh = () => void load(pathRef.current, { keepOnScreen: true });

  useServerEvent('note:changed', (event) => {
    if (samePath(event.path, pathRef.current)) refresh();
  });
  useServerEvent('note:created', (event) => {
    if (samePath(event.path, pathRef.current)) refresh();
  });
  useServerEvent('note:deleted', (event) => {
    if (!samePath(event.path, pathRef.current)) return;
    seq.current += 1;
    replaceDoc(null);
    setState({ status: 'missing' });
  });
  useServerEvent('resync', refresh);

  return { state, reload: () => void load(pathRef.current, { keepOnScreen: false }) };
}
