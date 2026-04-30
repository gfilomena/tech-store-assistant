import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  getProductById,
  getProductCount,
  initCatalogDb,
  listAllProductIds,
  listCategories,
  listProducts,
  loadCatalog,
} from "./catalogStore.js";
import { inventoryRedisHealth, seedInventoryIfConfigured } from "./inventoryRedis.js";

initCatalogDb();
try {
  await seedInventoryIfConfigured(listAllProductIds());
} catch (e) {
  console.warn(
    "[catalog-api][redis] Startup inventory seed threw (continuing):",
    e instanceof Error ? e.message : String(e),
  );
}

/**
 * Vercel Services routing sometimes forwards the full prefix to the backend,
 * and sometimes strips it depending on the runtime/framework integration.
 * To be robust, we mount routes both at `/...` and at `/_/catalog-api/...`.
 */
const SERVICE_PREFIX = "/_/catalog-api";

function registerRoutes(app: Hono) {
  const allowOrigin = process.env.CATALOG_CORS_ORIGIN?.trim() || "*";

  app.use("*", async (c, next) => {
    const startedAt = Date.now();
    const method = c.req.method;
    const url = new URL(c.req.url);

    try {
      await next();
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      console.log(
        `[catalog-api] ${method} ${url.pathname}${url.search} -> ERROR (${elapsedMs}ms)`,
      );
      throw err;
    }

    const elapsedMs = Date.now() - startedAt;
    const status = c.res.status;
    console.log(
      `[catalog-api] ${method} ${url.pathname}${url.search} -> ${status} (${elapsedMs}ms)`,
    );
  });

  app.use(
    "*",
    cors({
      origin: allowOrigin === "*" ? "*" : allowOrigin.split(",").map((s) => s.trim()),
      allowMethods: ["GET", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type"],
    }),
  );

  app.use("*", async (c, next) => {
    const token = process.env.CATALOG_API_TOKEN?.trim();
    if (!token) return next();
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${token}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  app.get("/health", async (c) => {
    const redis = await inventoryRedisHealth();
    return c.json({
      ok: true,
      service: "catalog-api",
      productCount: getProductCount(),
      inventory: { redis },
    });
  });

  /** Full catalog document (`{ products: Product[] }`). */
  app.get("/v1/catalog", async (c) => {
    const { products } = await loadCatalog();
    return c.json({ products });
  });

  app.get("/v1/categories", (c) => {
    const categories = listCategories();
    return c.json({ categories });
  });

  app.get("/v1/products", async (c) => {
    const q = c.req.query("q");
    const category = c.req.query("category");
    const products = await listProducts({ q, category });
    return c.json({ products, count: products.length });
  });

  app.get("/v1/products/:id", async (c) => {
    const id = c.req.param("id");
    const product = await getProductById(id);
    if (!product) return c.json({ error: "Not found" }, 404);
    return c.json({ product });
  });
}

const app = new Hono();
registerRoutes(app);

const prefixed = new Hono().basePath(SERVICE_PREFIX);
registerRoutes(prefixed);
app.route(SERVICE_PREFIX, prefixed);

/**
 * Vercel’s Hono framework expects the Hono app as the default export.
 * (The `handle()` adapter is primarily for Next.js route handlers.)
 */
export default app;

const port = Number.parseInt(process.env.PORT || "4001", 10);
const host = process.env.HOST?.trim() || "0.0.0.0";

if (!process.env.VERCEL && !process.env.VERCEL_ENV) {
  serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    console.log(
      `catalog-api listening on http://${info.address}:${info.port} (mount / and ${SERVICE_PREFIX})`,
    );
  });
}
