import type { EmbeddedChunk } from "../domain/product";
import { dotProduct, normalizeVector } from "./similarity";

export type RetrievedChunk = {
  chunk: EmbeddedChunk;
  score: number;
};

/**
 * Top-k by cosine similarity. Embeddings are normalized internally for a stable dot score.
 */
export function retrieveTopK(
  queryEmbedding: number[],
  embeddedChunks: EmbeddedChunk[],
  k: number,
): RetrievedChunk[] {
  if (k <= 0) return [];
  const q = normalizeVector(queryEmbedding);
  const scored = embeddedChunks.map((chunk) => ({
    chunk,
    score: dotProduct(q, normalizeVector(chunk.embedding)),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
