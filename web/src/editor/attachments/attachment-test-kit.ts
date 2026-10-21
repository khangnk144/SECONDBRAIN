/**
 * Test helpers for attachments: a fake `POST /api/attachments` behind the fetch mock (it records
 * the multipart fields, which the JSON-only mock cannot read), fake object URLs (jsdom has none),
 * and drop/paste events carrying files.
 */
import { vi } from 'vitest';
import type { AttachmentUploadResponse } from '../../lib/api/attachments-types';
import type { FetchMock, MockReply } from '../../lib/testing/fetch-mock';

export interface RecordedUpload {
  /** Multipart field names in the order they were sent. */
  fields: string[];
  target: string;
  file: File;
  headers: Record<string, string>;
}

export type UploadReply = (upload: RecordedUpload, index: number) => MockReply | Promise<MockReply>;

/** Where the fake server puts a file (images by month, documents by target), like the real one. */
export function uploadedPath(name: string, target: string): string {
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return `Attachments/2026-10/${name}`;
  const folder = target === 'auto' ? (name.endsWith('.pdf') ? 'papers' : 'other') : target;
  return `3 Resources/${folder}/${name}`;
}

export function uploadResponse(path: string): AttachmentUploadResponse {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const image = /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
  return {
    path,
    name,
    kind: image ? 'image' : name.endsWith('.pdf') ? 'pdf' : 'document',
    link: image ? `![[${name}]]` : `[[${name}]]`,
  };
}

export function installUploadServer(mock: FetchMock, reply?: UploadReply): RecordedUpload[] {
  const uploads: RecordedUpload[] = [];
  const inner = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/attachments' && init?.body instanceof FormData) {
      const form = init.body;
      uploads.push({
        fields: [...form.keys()],
        target: String(form.get('target')),
        file: form.get('file') as File,
        headers: { ...(init.headers as Record<string, string>) },
      });
    }
    return inner(input, init);
  });
  mock.on('POST /api/attachments', (_call) => {
    const index = uploads.length - 1;
    const upload = uploads[index]!;
    if (reply) return reply(upload, index);
    return {
      status: 201,
      body: uploadResponse(uploadedPath(upload.file.name, upload.target)),
    };
  });
  return uploads;
}

export interface FakeObjectUrls {
  created: string[];
  revoked: string[];
  restore(): void;
}

export function installObjectUrls(): FakeObjectUrls {
  const created: string[] = [];
  const revoked: string[] = [];
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = () => {
    const url = `blob:test/${created.length + 1}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
  return {
    created,
    revoked,
    restore: () => {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    },
  };
}

export function file(name: string, type = mimeFor(name), content = 'x'): File {
  return new File([content], name, { type });
}

function mimeFor(name: string): string {
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.svg')) return 'image/svg+xml';
  if (name.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

/** A DataTransfer stand-in (jsdom has none) holding `files`. */
export function filesTransfer(files: File[], strings: Record<string, string> = {}): DataTransfer {
  const items = [
    ...files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    ...Object.keys(strings).map((type) => ({ kind: 'string', type, getAsFile: () => null })),
  ];
  return {
    files: files as unknown as FileList,
    items: items as unknown as DataTransferItemList,
    types: [...(files.length > 0 ? ['Files'] : []), ...Object.keys(strings)],
    getData: (type: string) => strings[type] ?? '',
    dropEffect: 'none',
  } as unknown as DataTransfer;
}

/** A `drop` event with files (jsdom has no DragEvent). */
export function dropEvent(files: File[], strings: Record<string, string> = {}): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: filesTransfer(files, strings) });
  Object.assign(event, { clientX: 0, clientY: 0 });
  return event;
}

/** A `paste` event with files. */
export function pasteEvent(files: File[], strings: Record<string, string> = {}): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: filesTransfer(files, strings) });
  return event;
}
