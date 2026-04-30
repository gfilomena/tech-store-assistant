import type { Catalog, Product, ProductCategory } from "../../../src/domain/product.js";
import * as memory from "./catalogStoreMemory.js";
import { getDb } from "./db.js";
import { getInventoryQuantities } from "./inventoryRedis.js";
import { seedProductsFromMock } from "./seed.js";

const CATEGORIES: ReadonlySet<string> = new Set([
  "tv",
  "smartphone",
  "laptop",
  "appliance",
  "audio",
  "wearable",
]);

type ProductRow = {
  id: string;
  name: string;
  category: string;
  brand: string;
  price: number;
  currency: string;
  description: string;
  specs_json: string;
  faqs_json: string | null;
};

let initialized = false;

/** Vercel serverless cannot load `better-sqlite3` reliably; use in-memory catalog from JSON. */
function useMemoryCatalog(): boolean {
  return Boolean(process.env.VERCEL);
}

/**
 * Opens SQLite, ensures schema, and seeds from the catalog JSON when the DB is empty
 * (or when `CATALOG_FORCE_RESEED=1`). Call once before handling traffic.
 */
export function initCatalogDb(): void {
  if (initialized) return;
  if (useMemoryCatalog()) {
    memory.initMemoryCatalog();
    initialized = true;
    return;
  }
  const database = getDb();
  const row = database.prepare("SELECT COUNT(*) AS c FROM products").get() as { c: number };
  const force = process.env.CATALOG_FORCE_RESEED?.trim() === "1";
  if (row.c === 0 || force) {
    if (force) database.prepare("DELETE FROM products").run();
    const n = seedProductsFromMock(database);
    console.log(
      `[catalog-api] Seeded ${n} product(s) from seed file` + (force ? " (CATALOG_FORCE_RESEED=1)." : "."),
    );
  } else {
    console.log(`[catalog-api] Using existing DB with ${row.c} product(s).`);
  }
  initialized = true;
}

function rowToProduct(row: ProductRow): Product {
  const product: Product = {
    id: row.id,
    name: row.name,
    category: row.category as Product["category"],
    brand: row.brand,
    price: row.price,
    currency: row.currency,
    description: row.description,
    specs: JSON.parse(row.specs_json) as Product["specs"],
  };
  if (row.faqs_json) {
    product.faqs = JSON.parse(row.faqs_json) as Product["faqs"];
  }
  return product;
}

export function getProductCount(): number {
  if (useMemoryCatalog()) return memory.getProductCount();
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM products").get() as { c: number };
  return row.c;
}

export function listAllProductIds(): string[] {
  if (useMemoryCatalog()) return memory.listProductIdsSorted();
  return (
    getDb().prepare("SELECT id FROM products ORDER BY id").all() as Array<{ id: string }>
  ).map((r) => r.id);
}

export async function loadCatalog(): Promise<Catalog> {
  if (useMemoryCatalog()) return memory.loadCatalog();
  const rows = getDb().prepare("SELECT * FROM products ORDER BY id").all() as ProductRow[];
  const products = rows.map(rowToProduct);
  const ids = products.map((p) => p.id);
  const qtyById = await getInventoryQuantities(ids);
  for (const p of products) {
    const qty = qtyById.get(p.id);
    if (qty === undefined) continue;
    if (qty === null) {
      delete p.inStock;
      continue;
    }
    p.inStock = qty;
  }
  return { products };
}

export function listCategories(): ProductCategory[] {
  if (useMemoryCatalog()) return memory.listCategories();
  const rows = getDb()
    .prepare("SELECT DISTINCT category FROM products ORDER BY category COLLATE NOCASE")
    .all() as Array<{ category: string }>;
  const out: ProductCategory[] = [];
  for (const { category } of rows) {
    if (CATEGORIES.has(category)) out.push(category as ProductCategory);
  }
  return out;
}

export type ListProductsFilters = {
  q?: string;
  category?: string;
};

export async function listProducts(filters: ListProductsFilters): Promise<Product[]> {
  if (useMemoryCatalog()) return memory.listProducts(filters);
  const cat = filters.category?.trim().toLowerCase();
  if (cat && !CATEGORIES.has(cat)) return [];

  const qRaw = filters.q?.trim().toLowerCase();
  /** Avoid LIKE metacharacters in user input. */
  const safe = qRaw ? qRaw.replace(/[%_]/g, " ") : "";

  if (!cat && !safe) {
    const rows = getDb().prepare("SELECT * FROM products ORDER BY id").all() as ProductRow[];
    const products = rows.map(rowToProduct);
    const ids = products.map((p) => p.id);
    const qtyById = await getInventoryQuantities(ids);
    for (const p of products) {
      const qty = qtyById.get(p.id);
      if (qty === undefined) continue;
      if (qty === null) {
        delete p.inStock;
        continue;
      }
      p.inStock = qty;
    }
    return products;
  }

  let sql = "SELECT * FROM products WHERE 1=1";
  const params: unknown[] = [];
  if (cat) {
    sql += " AND category = ?";
    params.push(cat);
  }
  if (safe) {
    const like = `%${safe}%`;
    sql +=
      " AND (LOWER(id) LIKE LOWER(?) OR LOWER(name) LIKE LOWER(?) OR LOWER(brand) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?))";
    params.push(like, like, like, like);
  }
  sql += " ORDER BY id";
  const rows = getDb().prepare(sql).all(...params) as ProductRow[];
  const products = rows.map(rowToProduct);
  const ids = products.map((p) => p.id);
  const qtyById = await getInventoryQuantities(ids);
  for (const p of products) {
    const qty = qtyById.get(p.id);
    if (qty === undefined) continue;
    if (qty === null) {
      delete p.inStock;
      continue;
    }
    p.inStock = qty;
  }
  return products;
}

export async function getProductById(id: string): Promise<Product | undefined> {
  if (useMemoryCatalog()) return memory.getProductById(id);
  const row = getDb().prepare("SELECT * FROM products WHERE id = ?").get(id) as
    | ProductRow
    | undefined;
  if (!row) return undefined;
  const product = rowToProduct(row);
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
