/**
 * Runs PDF text extraction in a `worker_threads` worker so a large or hostile PDF never blocks
 * the server's event loop. One job at a time (the caller serializes); the worker starts on first
 * use, is terminated by `reset()` (timeout) and started again after a crash.
 *
 * Memory: the worker shares the server's process, so its heap is capped (V8 limits) and a
 * watchdog terminates it when its buffers outside the heap (pdf.js keeps decoded streams in
 * ArrayBuffers, which no heap limit counts) pass a cap: a small "deflate bomb" cannot take the
 * server down. The job then fails with `ExtractorMemoryError`.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker, type ResourceLimits } from 'node:worker_threads';
import type { PdfExtraction, PdfLimits } from './pdf-text-extraction.js';

export interface PdfExtractor {
  /** Rejects with `ExtractorCrashError` when the worker died during the job. */
  extract(bytes: Uint8Array, limits: PdfLimits): Promise<PdfExtraction>;
  /** Abandons the job in progress (its promise rejects); the next call starts a fresh worker. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export class ExtractorCrashError extends Error {
  constructor(readonly exitCode: number | null) {
    super('The PDF extraction worker stopped unexpectedly.');
    this.name = 'ExtractorCrashError';
  }
}

/** The worker needed more memory than allowed (heap or decoded buffers) and was stopped. */
export class ExtractorMemoryError extends ExtractorCrashError {
  constructor() {
    super(null);
    this.message = 'The PDF needed more memory than allowed.';
    this.name = 'ExtractorMemoryError';
  }
}

export interface WorkerPdfExtractorOptions {
  /** Worker module (tests pass a stub); default `pdf-text-worker` next to this file. */
  workerUrl?: URL;
  /** Heap cap of the worker: a PDF that needs more crashes the worker, not the server. */
  maxHeapMb?: number;
  /** Buffers outside the heap allowed per job, on top of three copies of the file. */
  maxBuffersMb?: number;
  /** How often the watchdog looks at the worker's memory during a job. */
  watchIntervalMs?: number;
}

const MB = 1024 * 1024;
const DEFAULT_HEAP_MB = 512;
const DEFAULT_YOUNG_MB = 32;
const DEFAULT_BUFFERS_MB = 256;
const DEFAULT_WATCH_MS = 20;

const ownExtension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
const DEFAULT_WORKER = new URL(`./pdf-text-worker${ownExtension}`, import.meta.url);

/**
 * From the TypeScript sources (dev server, tests) Node cannot resolve the worker's `.js` imports
 * by itself, so the worker first registers tsx (a dev dependency, present wherever sources run).
 * The built server (`dist/`) loads the compiled `.js` worker directly.
 */
function spawn(url: URL, resourceLimits: ResourceLimits): Worker {
  const options = { resourceLimits, stdout: true, stderr: true };
  if (!url.pathname.endsWith('.ts')) return new Worker(url, options);
  const require = createRequire(import.meta.url);
  const tsxApi = pathToFileURL(require.resolve('tsx/esm/api').replace(/\.cjs$/, '.mjs')).href;
  const code =
    `import(${JSON.stringify(tsxApi)}).then((tsx) => { tsx.register(); ` +
    `return import(${JSON.stringify(url.href)}); });`;
  return new Worker(code, { ...options, eval: true });
}

interface Pending {
  id: number;
  /** The worker running the job (a stopped one's late `exit` must not end the next job). */
  worker: Worker;
  resolve: (result: PdfExtraction) => void;
  reject: (error: Error) => void;
  watchdog: NodeJS.Timeout;
}

const isOutOfMemory = (error: unknown) =>
  (error as NodeJS.ErrnoException | null)?.code === 'ERR_WORKER_OUT_OF_MEMORY';

export function createWorkerPdfExtractor(options: WorkerPdfExtractorOptions = {}): PdfExtractor {
  const url = options.workerUrl ?? DEFAULT_WORKER;
  const limits: ResourceLimits = {
    maxOldGenerationSizeMb: options.maxHeapMb ?? DEFAULT_HEAP_MB,
    maxYoungGenerationSizeMb: DEFAULT_YOUNG_MB,
  };
  const buffersCap = (options.maxBuffersMb ?? DEFAULT_BUFFERS_MB) * MB;
  const watchMs = options.watchIntervalMs ?? DEFAULT_WATCH_MS;
  let worker: Worker | null = null;
  let pending: Pending | null = null;
  let nextId = 1;

  /** Ends the job `from` was running (if any) and forgets `from` when it is the current worker. */
  function fail(from: Worker, error: Error): void {
    if (worker === from) worker = null;
    const job = pending;
    if (!job || job.worker !== from) return;
    pending = null;
    clearInterval(job.watchdog);
    job.reject(error);
  }

  /**
   * The worker's buffers outside the heap, read while it runs (V8 answers between two steps of
   * even a long synchronous decode). Over the cap: stop it at once, before the buffer fills.
   */
  function watch(target: Worker, cap: number): NodeJS.Timeout {
    let reading = false;
    const timer = setInterval(() => {
      if (reading) return;
      let stats: Promise<{ external_memory: number }>;
      try {
        stats = target.getHeapStatistics();
      } catch {
        return; // not running yet (starting) or already gone: nothing to watch now
      }
      reading = true;
      stats.then(
        ({ external_memory: external }) => {
          reading = false;
          if (external <= cap || worker !== target) return;
          fail(target, new ExtractorMemoryError());
          void target.terminate();
        },
        () => {
          reading = false;
        },
      );
    }, watchMs);
    timer.unref();
    return timer;
  }

  function ensureWorker(): Worker {
    if (worker) return worker;
    const started = spawn(url, limits);
    // pdf.js may print to the console; its output could quote document text: never forward it.
    started.stdout.resume();
    started.stderr.resume();
    started.on('message', (message: { id: number; result: PdfExtraction }) => {
      if (pending?.id !== message.id) return;
      const job = pending;
      pending = null;
      clearInterval(job.watchdog);
      job.resolve(message.result);
    });
    started.on('error', (error) =>
      fail(
        started,
        isOutOfMemory(error) ? new ExtractorMemoryError() : new ExtractorCrashError(null),
      ),
    );
    started.on('exit', (code) => fail(started, new ExtractorCrashError(code)));
    started.unref(); // an idle worker never keeps the server process alive
    worker = started;
    return started;
  }

  return {
    extract(bytes, jobLimits) {
      if (pending) return Promise.reject(new Error('The PDF extractor is busy.'));
      const target = ensureWorker();
      const id = nextId++;
      // The file arrives as a copy, and pdf.js may copy it again: room for those on top.
      const cap = buffersCap + 3 * bytes.byteLength;
      return new Promise<PdfExtraction>((resolve, reject) => {
        pending = { id, worker: target, resolve, reject, watchdog: watch(target, cap) };
        target.postMessage({ id, bytes, limits: jobLimits });
      });
    },
    async reset() {
      const current = worker;
      worker = null;
      const job = pending;
      pending = null;
      if (job) clearInterval(job.watchdog);
      job?.reject(new ExtractorCrashError(null));
      await current?.terminate();
    },
    async close() {
      await this.reset();
    },
  };
}
