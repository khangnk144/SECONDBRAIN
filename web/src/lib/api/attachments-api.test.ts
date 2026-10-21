import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  file,
  installUploadServer,
  type RecordedUpload,
} from '../../editor/attachments/attachment-test-kit';
import { setApiToken } from '../api';
import { ApiError } from '../api-client';
import { apiError, installFetchMock, type FetchMock } from '../testing/fetch-mock';
import { uploadAttachment } from './attachments-api';

describe('uploadAttachment (F15.1)', () => {
  let mock: FetchMock;
  let uploads: RecordedUpload[];

  beforeEach(() => {
    setApiToken('token-xyz');
    mock = installFetchMock();
    uploads = installUploadServer(mock);
  });
  afterEach(() => {
    setApiToken(null);
    vi.unstubAllGlobals();
  });

  it('posts target then file, with the token and without a hand-made content type', async () => {
    const result = await uploadAttachment(file('bài giảng 3.pdf'), 'papers');
    expect(result).toEqual({
      path: '3 Resources/papers/bài giảng 3.pdf',
      name: 'bài giảng 3.pdf',
      kind: 'pdf',
      link: '[[bài giảng 3.pdf]]',
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.fields).toEqual(['target', 'file']);
    expect(uploads[0]!.target).toBe('papers');
    expect(uploads[0]!.file.name).toBe('bài giảng 3.pdf');
    expect(uploads[0]!.headers['X-SB-Token']).toBe('token-xyz');
    expect(Object.keys(uploads[0]!.headers).map((h) => h.toLowerCase())).not.toContain(
      'content-type',
    );
  });

  it('turns an error answer into an ApiError with its status and code', async () => {
    mock.on('POST /api/attachments', apiError(413, 'VALIDATION', { reason: 'too-large' }));
    const error = await uploadAttachment(file('video.png'), 'auto').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 413,
      code: 'VALIDATION',
      details: { reason: 'too-large' },
    });
  });
});
