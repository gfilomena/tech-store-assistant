import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Database } from "better-sqlite3";

const require = createRequire(import.meta.url);

export type CatalogSqliteDb = Database;

let db: CatalogSqliteDb | null = null;

/** Lazy-load native module so Vercel memory-mode never touches `better-sqlite3`. */
function sqliteDatabaseCtor(): new (path: string) => Database {
  return require("better-sqlite3") as new (path: string) => Database;
}

function defaultDbPath(): string {
  const rel = process.env.CATALOG_DB_PATH?.trim();
  if (rel) return join(process.cwd(), rel);

  // Vercel runtime filesystem is read-only except for /tmp.
  if (process.env.VERCEL) return join("/", "tmp", "catalog.sqlite");

  return join(process.cwd(), "..", "..", "data", "catalog.sqlite");
}

export function getDb(): CatalogSqliteDb {
  if (db) return db;
  const BetterSqlite3 = sqliteDatabaseCtor();
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
