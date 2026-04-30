import { describe, expect, it } from "vitest";
import type { EmbeddedChunk } from "../src/domain/product.js";
import { retrieveTopK } from "../src/rag/retrieve.js";
import { normalizeVector } from "../src/rag/similarity.js";

function emb(
  productId: string,
  chunkId: string,
  vector: number[],
): EmbeddedChunk {
  const base = {
    chunkId,
    productId,
    section: "overview" as const,
    text: chunkId,
  };
  return { ...base, embedding: normalizeVector(vector) };
}

describe("retrieveTopK", () => {
  it("returns highest-similarity chunks first", () => {
    const chunks: EmbeddedChunk[] = [
      emb("a", "a:1", [1, 0, 0]),
      emb("b", "b:1", [0, 1, 0]),
      emb("c", "c:1", [0, 0, 1]),
    ];
    const q = normalizeVector([1, 0.1, 0]);
    const hits = retrieveTopK(q, chunks, 2);
    expect(hits[0]?.chunk.productId).toBe("a");
    expect(hits.length).toBe(2);
  });

  it("returns empty list when k is 0", () => {
    const hits = retrieveTopK([1, 0, 0], [], 0);
    expect(hits).toEqual([]);
  });
});
