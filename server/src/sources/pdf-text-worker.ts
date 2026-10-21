/**
 * Entry of the PDF extraction worker thread: one job at a time, `{ id, bytes, limits }` in,
 * `{ id, result }` out. A hostile PDF can hang or exhaust only this thread; the host terminates
 * and restarts it (`pdf-worker-extractor.ts`).
 */
import { parentPort } from 'node:worker_threads';
import { extractPdfText, type PdfLimits } from './pdf-text-extraction.js';

interface PdfJob {
  id: number;
  bytes: Uint8Array;
  limits: PdfLimits;
}

const port = parentPort;
if (!port) throw new Error('The PDF text worker must run in a worker thread.');

port.on('message', (job: PdfJob) => {
  void extractPdfText(job.bytes, job.limits).then((result) => {
    port.postMessage({ id: job.id, result });
  });
});
