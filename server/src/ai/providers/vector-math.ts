/** Small numeric helpers for embeddings: validation, unit vectors, dot products, blobs. */
import { providerError } from './provider-http.js';

/** Rough token count of texts when a provider reports none (about 4 characters per token). */
export function estimateTextTokens(texts: readonly string[]): number {
  let characters = 0;
  for (const text of texts) characters += text.length;
  return Math.ceil(characters / 4);
}

/**
 * Checks provider vectors (right size, finite numbers) and scales them to length 1, so cosine
 * similarity is a plain dot product later (Gemini's reduced-size vectors are not normalized).
 */
export function toUnitVectors(
  arrays: readonly (readonly unknown[] | undefined)[],
  dims: number,
): Float32Array[] {
  return arrays.map((array) => {
    if (!array || array.length !== dims) throw providerError('malformed');
    const vector = new Float32Array(dims);
    let norm = 0;
    for (let i = 0; i < dims; i += 1) {
      const value = array[i];
      if (typeof value !== 'number' || !Number.isFinite(value)) throw providerError('malformed');
      vector[i] = value;
      norm += value * value;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < dims; i += 1) vector[i] = vector[i]! / norm;
    return vector;
  });
}

export function dot(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < length; i += 1) sum += a[i]! * b[i]!;
  return sum;
}

export function vectorToBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

/** Dot product of a unit query vector with a stored blob, without copying aligned blobs. */
export function dotBlob(query: Float32Array, blob: Uint8Array): number {
  const vector =
    blob.byteOffset % 4 === 0
      ? new Float32Array(blob.buffer, blob.byteOffset, Math.floor(blob.byteLength / 4))
      : blobToVector(blob);
  return dot(query, vector);
}

/** A copy (SQLite buffers may be reused or unaligned for Float32Array views). */
export function blobToVector(blob: Uint8Array): Float32Array {
  const copy = new Uint8Array(blob.byteLength);
  copy.set(blob);
  return new Float32Array(copy.buffer, 0, Math.floor(blob.byteLength / 4));
}
