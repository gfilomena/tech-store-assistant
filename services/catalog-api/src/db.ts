import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import BetterSqlite3 from "better-sqlite3";

export type CatalogSqliteDb = InstanceType<typeof BetterSqlite3>;

let db: CatalogSqliteDb | null = null;

function defaultDbPath(): string {
  const rel = process.env.CATALOG_DB_PATH?.trim();
  if (rel) return join(process.cwd(), rel);

  // Vercel runtime filesystem is read-only except for /tmp.
  if (process.env.VERCEL) return join("/", "tmp", "catalog.sqlite");

  return join(process.cwd(), "..", "..", "data", "catalog.sqlite");
}

export function getDb(): CatalogSqliteDb {
  if (db) return db;
  const path = defaultDbPath();
  mkdirSync(dirname(path), { recursive: true });
  db = new BetterSqlite3(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      brand TEXT NOT NULL,
      price REAL NOT NULL,
      currency TEXT NOT NULL,
      description TEXT NOT NULL,
      specs_json TEXT NOT NULL,
      faqs_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
  `);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
