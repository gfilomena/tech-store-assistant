/** Vector math utilities used by retrieval scoring (normalize + dot/cosine). */
export function l2Norm(v: number[]): number {
  return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
}

export function normalizeVector(v: number[]): number[] {
  const norm = l2Norm(v);
  if (norm === 0) return v.slice();
  return v.map((x) => x / norm);
}

/** Dot product of two equal-length vectors. */
export function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Cosine similarity in [-1, 1]. For typical OpenAI embeddings,
 * pre-normalizing both vectors makes this equivalent to dotProduct(norm(a), norm(b)).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const na = l2Norm(a);
  const nb = l2Norm(b);
  if (na === 0 || nb === 0) return 0;
  return dotProduct(a, b) / (na * nb);
}
