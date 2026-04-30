import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  dotProduct,
  l2Norm,
  normalizeVector,
} from "../src/rag/similarity.js";

describe("similarity", () => {
  it("normalizes to unit length", () => {
    const n = normalizeVector([3, 4, 0]);
    expect(l2Norm(n)).toBeCloseTo(1);
  });

  it("dotProduct of normalized vectors equals cosine of originals", () => {
    const a = normalizeVector([1, 0, 0]);
    const b = normalizeVector([1, 1, 0]);
    expect(dotProduct(a, b)).toBeCloseTo(cosineSimilarity([1, 0, 0], [1, 1, 0]));
  });

  it("cosineSimilarity is 1 for parallel vectors", () => {
    expect(cosineSimilarity([2, 0, 0], [5, 0, 0])).toBeCloseTo(1);
  });

  it("cosineSimilarity is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });
});
