import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseCatalog, type Catalog } from "../domain/product";

/** Same path rules as RAG indexing (`indexSingleton`). */
export function getRagCatalogRelPath(): string {
  return (
    process.env.RAG_CATALOG_PATH?.trim() || join("data", "catalog.generated.5000.json")
  );
}

type CountCache = { rel: string; mtimeMs: number; count: number };
let countCache: CountCache | null = null;

type CatalogCache = { rel: string; mtimeMs: number; catalog: Catalog };
let catalogCache: CatalogCache | null = null;

/** Product rows in the JSON catalog backing RAG (not the HTTP catalog-api). */
export function getCatalogProductCount(): number {
  const rel = getRagCatalogRelPath();
  const abs = join(process.cwd(), rel);
  const st = statSync(abs);
  if (countCache && countCache.rel === rel && countCache.mtimeMs === st.mtimeMs) {
    return countCache.count;
  }
  const raw = readFileSync(abs, "utf-8");
  const count = parseCatalog(JSON.parse(raw) as unknown).products.length;
  countCache = { rel, mtimeMs: st.mtimeMs, count };
  return count;
}

/** Parsed catalog with basic mtime cache (for demo/runtime shortcuts). */
export function getCatalogSnapshot(): Catalog {
  const rel = getRagCatalogRelPath();
  const abs = join(process.cwd(), rel);
  const st = statSync(abs);
  if (catalogCache && catalogCache.rel === rel && catalogCache.mtimeMs === st.mtimeMs) {
    return catalogCache.catalog;
  }
  const raw = readFileSync(abs, "utf-8");
  const catalog = parseCatalog(JSON.parse(raw) as unknown);
  catalogCache = { rel, mtimeMs: st.mtimeMs, catalog };
  return catalog;
}
