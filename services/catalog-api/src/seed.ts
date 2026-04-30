import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Product } from "../../../src/domain/product.js";
import { parseCatalog } from "../../../src/domain/product.js";
import type { CatalogSqliteDb } from "./db.js";

function seedJsonPath(): string {
  const rel = process.env.CATALOG_SEED_PATH?.trim();
  if (rel) return join(process.cwd(), rel);
  return join(process.cwd(), "..", "..", "data", "catalog.generated.5000.json");
}

export function seedProductsFromMock(database: CatalogSqliteDb): number {
  const path = seedJsonPath();
  const raw = readFileSync(path, "utf-8");
  const catalog = parseCatalog(JSON.parse(raw) as unknown);
  const insert = database.prepare(`
    INSERT INTO products (id, name, category, brand, price, currency, description, specs_json, faqs_json)
    VALUES (@id, @name, @category, @brand, @price, @currency, @description, @specs_json, @faqs_json)
  `);
  const run = database.transaction((products: Product[]) => {
    for (const p of products) {
      insert.run({
        id: p.id,
        name: p.name,
        category: p.category,
        brand: p.brand,
        price: p.price,
        currency: p.currency,
        description: p.description,
        specs_json: JSON.stringify(p.specs),
        faqs_json: p.faqs?.length ? JSON.stringify(p.faqs) : null,
      });
    }
  });
  run(catalog.products);
  return catalog.products.length;
}
