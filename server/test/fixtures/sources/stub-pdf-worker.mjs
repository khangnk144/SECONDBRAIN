// Stand-in for the PDF text worker (tests of the worker host): a job whose first byte is "X"
// kills the thread like a native crash would; "M" keeps allocating buffers in one synchronous
// loop (like pdf.js inflating a "deflate bomb") until the host stops it; any other job gets a
// one-page answer.
import { parentPort } from 'node:worker_threads';

parentPort.on('message', (job) => {
  if (job.bytes[0] === 0x58) process.exit(3);
  if (job.bytes[0] === 0x4d) {
    const kept = [];
    for (let i = 0; i < 512; i += 1) {
      const chunk = new Uint8Array(1024 * 1024);
      for (let j = 0; j < chunk.length; j += 4096) chunk[j] = 1; // touch every page
      kept.push(chunk);
    }
    parentPort.postMessage({ id: job.id, result: { kind: 'ok', pages: [String(kept.length)] } });
    return;
  }
  parentPort.postMessage({
    id: job.id,
    result: { kind: 'ok', pages: [`stub page of ${job.bytes.length} bytes`], title: null, truncated: false },
  });
});
