import { describe, expect, it } from "vitest";
import { parseCatalog } from "../src/domain/product.js";
import { chunkCatalog } from "../src/rag/chunkCatalog.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(__dirname, "..", "data", "catalog.generated.5000.json");

describe("parseCatalog", () => {
  it("rejects non-objects", () => {
    expect(() => parseCatalog(null)).toThrow(/JSON object/);
  });

  it("rejects missing products array", () => {
    expect(() => parseCatalog({})).toThrow(/products/);
  });

  it("parses bundled sample catalog", () => {
    const raw = JSON.parse(readFileSync(catalogPath, "utf-8")) as unknown;
    const catalog = parseCatalog(raw);
    expect(catalog.products.length).toBeGreaterThan(0);
    const chunks = chunkCatalog(catalog);
    expect(chunks.length).toBeGreaterThanOrEqual(catalog.products.length * 2);
  });
});
