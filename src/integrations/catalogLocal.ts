import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseCatalog, type Catalog, type Product, type ProductCategory } from "../domain/product";
import { getRagCatalogRelPath } from "../rag/catalogMeta";

type LocalCatalogCache = { rel: string; mtimeMs: number; catalog: Catalog };
const cacheKey = "__localCatalogCache__";

function getCache(): LocalCatalogCache | null {
  const g = globalThis as unknown as Record<string, unknown>;
  return (g[cacheKey] as LocalCatalogCache | null) ?? null;
}

function setCache(next: LocalCatalogCache) {
  const g = globalThis as unknown as Record<string, unknown>;
  g[cacheKey] = next;
}

function loadCatalog(): Catalog {
  const rel = getRagCatalogRelPath();
  const abs = join(process.cwd(), rel);
  const st = statSync(abs);
  const cur = getCache();
  if (cur && cur.rel === rel && cur.mtimeMs === st.mtimeMs) return cur.catalog;

  const raw = readFileSync(abs, "utf-8");
  const catalog = parseCatalog(JSON.parse(raw) as unknown);
  setCache({ rel, mtimeMs: st.mtimeMs, catalog });
  return catalog;
}

export async function getLocalCatalogDocument(): Promise<Catalog> {
  return loadCatalog();
}

export async function getLocalCategories(): Promise<{ categories: ProductCategory[] }> {
  const cat = loadCatalog();
  const set = new Set<ProductCategory>();
  for (const p of cat.products) set.add(p.category);
  return { categories: [...set].sort() };
}

export async function getLocalProducts(searchParams: URLSearchParams): Promise<{ products: Product[]; count: number }> {
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const category = (searchParams.get("category") ?? "").trim().toLowerCase();

  const cat = loadCatalog();
  let products = cat.products;

  if (category) {
    products = products.filter((p) => p.category.toLowerCase() === category);
  }

  if (q) {
    products = products.filter((p) => {
      const hay = `${p.name} ${p.brand} ${p.description}`.toLowerCase();
      return hay.includes(q);
    });
  }

  return { products, count: products.length };
}

export async function getLocalProduct(id: string): Promise<{ product: Product } | null> {
  const cat = loadCatalog();
  const p = cat.products.find((x) => x.id === id);
  if (!p) return null;
  return { product: p };
}

