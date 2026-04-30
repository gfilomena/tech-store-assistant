import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chunkCatalog } from "../src/rag/chunkCatalog";
import { retrieveTopK } from "../src/rag/retrieve";
import type { Catalog, EmbeddedChunk } from "../src/domain/product";

type ScenarioFile = {
  scenarios: Array<{
    id: string;
    category: string;
    user_utterances: string[];
  }>;
};

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function hashedVector(text: string, dim = 128): number[] {
  const v = new Array<number>(dim).fill(0);
  for (const t of tokenize(text)) {
    // deterministic tiny hash
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
    const idx = Math.abs(h) % dim;
    v[idx] += 1;
  }
  return v;
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (!norm) return v.slice();
  return v.map((x) => x / norm);
}

function buildDeterministicEmbeddedIndex(catalog: Catalog): EmbeddedChunk[] {
  const chunks = chunkCatalog(catalog);
  return chunks.map((c) => ({
    ...c,
    embedding: normalize(hashedVector(c.text)),
  }));
}

describe("retrieval sanity checks (deterministic embeddings)", () => {
  test("support scenarios retrieve chunks for the right category", () => {
    const catalogPath = join(process.cwd(), "data", "catalog.generated.5000.json");
    const rawCatalog = readFileSync(catalogPath, "utf-8");
    const catalog = JSON.parse(rawCatalog) as Catalog;
    const embedded = buildDeterministicEmbeddedIndex(catalog);

    const scenariosPath = join(process.cwd(), "data", "support-scenarios.json");
    const rawScenarios = readFileSync(scenariosPath, "utf-8");
    const scenarios = JSON.parse(rawScenarios) as ScenarioFile;

    let total = 0;
    let matched = 0;
    const misses: string[] = [];

    for (const s of scenarios.scenarios) {
      for (const utterance of s.user_utterances.slice(0, 2)) {
        const queryText =
          s.category && s.category !== "general"
            ? `Category: ${s.category}\n${s.category} ${utterance}`
            : utterance;
        const q = normalize(hashedVector(queryText));
        const hits = retrieveTopK(q, embedded, 5);
        expect(hits.length).toBeGreaterThan(0);
        const hitProducts = hits
          .map((h) => catalog.products.find((p) => p.id === h.chunk.productId))
          .filter(Boolean);
        expect(hitProducts.length).toBeGreaterThan(0);

        // category=general can map to anything
        if (s.category !== "general") {
          const hasCategoryMatch = hitProducts.some((p) => p!.category === s.category);
          total += 1;
          if (hasCategoryMatch) matched += 1;
          else misses.push(`${s.id} (${s.category}): ${utterance}`);
        }
      }
    }

    // This is a lightweight smoke test using a simplistic deterministic embedding.
    // We assert the overall retrieval signal is reasonable, not perfect.
    const rate = total ? matched / total : 1;
    expect(
      rate,
      `Category-hit rate too low: ${(rate * 100).toFixed(1)}%. Misses:\n- ${misses.slice(0, 6).join("\n- ")}`,
    ).toBeGreaterThanOrEqual(0.7);
  });
});

