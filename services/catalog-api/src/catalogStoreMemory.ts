import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Catalog, Product, ProductCategory } from "../../../src/domain/product.js";
import { parseCatalog } from "../../../src/domain/product.js";
import { getInventoryQuantities } from "./inventoryRedis.js";

const CATEGORIES: ReadonlySet<string> = new Set([
  "tv",
  "smartphone",
  "laptop",
  "appliance",
  "audio",
  "wearable",
]);

function resolveSeedPath(): string {
  const rel = process.env.CATALOG_SEED_PATH?.trim();
  if (rel) return join(process.cwd(), rel);

  const candidates = [
    join(process.cwd(), "data", "catalog.generated.5000.json"),
    join(process.cwd(), "..", "..", "data", "catalog.generated.5000.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

let products: Product[] | null = null;

function getProducts(): Product[] {
  if (products) return products;
  const path = resolveSeedPath();
  const raw = readFileSync(path, "utf-8");
  const catalog = parseCatalog(JSON.parse(raw) as unknown);
  products = catalog.products;
  return products;
}

export function initMemoryCatalog(): void {
  const path = resolveSeedPath();
  const n = getProducts().length;
  console.log(`[catalog-api][memory] loaded ${n} product(s) from ${path}`);
}

export function listProductIdsSorted(): string[] {
  return getProducts()
    .map((p) => p.id)
    .sort((a, b) => a.localeCompare(b));
}

export function getProductCount(): number {
  return getProducts().length;
}

async function attachInventory(list: Product[]): Promise<void> {
  const ids = list.map((p) => p.id);
  const qtyById = await getInventoryQuantities(ids);
  for (const p of list) {
    const qty = qtyById.get(p.id);
    if (qty === undefined) continue;
    if (qty === null) {
      delete p.inStock;
      continue;
    }
    p.inStock = qty;
  }
}

export async function loadCatalog(): Promise<Catalog> {
  const list = getProducts().map((p) => structuredClone(p));
  await attachInventory(list);
  return { products: list };
}

export function listCategories(): ProductCategory[] {
  const set = new Set<ProductCategory>();
  for (const p of getProducts()) {
    if (CATEGORIES.has(p.category)) set.add(p.category);
  }
  return [...set].sort();
}

export type ListProductsFilters = {
  q?: string;
  category?: string;
};

export async function listProducts(filters: ListProductsFilters): Promise<Product[]> {
  const cat = filters.category?.trim().toLowerCase();
  if (cat && !CATEGORIES.has(cat)) return [];

  const qRaw = filters.q?.trim().toLowerCase();
  const safe = qRaw ? qRaw.replace(/[%_]/g, " ") : "";

  let list = getProducts();
  if (cat) {
    list = list.filter((p) => p.category.toLowerCase() === cat);
  }
  if (safe) {
    list = list.filter((p) => {
      const hay = `${p.name} ${p.brand} ${p.description}`.toLowerCase();
      return hay.includes(safe);
    });
  }

  const out = list.map((p) => structuredClone(p)).sort((a, b) => a.id.localeCompare(b.id));
  await attachInventory(out);
  return out;
}

export async function getProductById(id: string): Promise<Product | undefined> {
  const p = getProducts().find((x) => x.id === id);
  if (!p) return undefined;
  const product = structuredClone(p);
  const qtyById = await getInventoryQuantities([product.id]);
  const qty = qtyById.get(product.id);
  if (qty === undefined) return product;
  if (qty === null) {
    delete product.inStock;
    return product;
  }
  product.inStock = qty;
  return product;
}
