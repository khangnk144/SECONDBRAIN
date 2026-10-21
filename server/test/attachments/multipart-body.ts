import { randomBytes } from 'node:crypto';

export type MultipartPart =
  | { name: string; value: string }
  | { name: string; filename: string; content: Buffer | string; contentType?: string };

/**
 * A multipart/form-data body as a browser sends it: the file name raw UTF-8 inside the quotes
 * (browsers escape `"`, CR and LF as %22, %0D, %0A), fields as plain parts.
 */
export function multipartBody(parts: MultipartPart[]): {
  payload: Buffer;
  contentType: string;
} {
  const boundary = `----sb-test-${randomBytes(8).toString('hex')}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let head = `--${boundary}\r\n`;
    if ('filename' in part) {
      const filename = part.filename
        .replace(/"/g, '%22')
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A');
      head += `Content-Disposition: form-data; name="${part.name}"; filename="${filename}"\r\n`;
      head += `Content-Type: ${part.contentType ?? 'application/octet-stream'}\r\n\r\n`;
      chunks.push(Buffer.from(head, 'utf8'), Buffer.from(part.content), Buffer.from('\r\n'));
    } else {
      head += `Content-Disposition: form-data; name="${part.name}"\r\n\r\n`;
      chunks.push(Buffer.from(head, 'utf8'), Buffer.from(part.value, 'utf8'), Buffer.from('\r\n'));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
