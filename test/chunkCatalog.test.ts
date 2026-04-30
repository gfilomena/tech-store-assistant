import { describe, expect, it } from "vitest";
import { chunkCatalog } from "../src/rag/chunkCatalog.js";
import type { Catalog } from "../src/domain/product.js";

const miniCatalog: Catalog = {
  products: [
    {
      id: "p1",
      name: "Test TV",
      category: "tv",
      brand: "T",
      price: 100,
      currency: "EUR",
      description: "A test television.",
      specs: { hdmi: "2.1" },
      faqs: [{ question: "Q?", answer: "A." }],
    },
    {
      id: "p2",
      name: "No FAQ Phone",
      category: "smartphone",
      brand: "P",
      price: 200,
      currency: "EUR",
      description: "Phone without FAQ.",
      specs: { ram: "8GB" },
    },
  ],
};

describe("chunkCatalog", () => {
  it("creates overview, specs, and faq chunks deterministically", () => {
    const chunks = chunkCatalog(miniCatalog);
    expect(chunks.map((c) => c.chunkId)).toEqual([
      "p1:overview",
      "p1:specs",
      "p1:faq:0",
      "p2:overview",
      "p2:specs",
    ]);
    expect(chunks[0]?.text).toContain("Test TV");
    expect(chunks[0]?.text).toContain("p1");
    expect(chunks[1]?.text).toContain("hdmi: 2.1");
    expect(chunks[2]?.text).toContain("Q?");
    expect(chunks[2]?.text).toContain("A.");
  });
});
