# Catalog API service + Next.js BFF

**Status:** Implemented in the repo (`services/catalog-api`, `src/integrations/catalogApiClient.ts`, `app/api/catalog/v1/*`). Default seed/RAG catalog file: [`data/catalog.generated.5000.json`](../data/catalog.generated.5000.json). The sections below remain a readable spec; prefer the source files if they diverge.

**Intent:** Isolate product data behind a **deployable REST service** (`services/catalog-api`). The Next.js app does **not** embed catalog HTTP URLs in the browser; it uses a thin **BFF** (`app/api/catalog/v1/*`) plus a small **`src/integrations`** client that calls the service **server-side only**.

---

## Layout

```text
services/catalog-api/
  package.json
  tsconfig.json
  Dockerfile
  README.md          (already present; adjust run paths if needed)
  src/
    server.ts        # Hono app + listen
    catalogStore.ts  # load JSON, parseCatalog, list/get

src/integrations/
  catalogApiClient.ts   # fetch wrapper (server-only)

app/api/catalog/v1/
  products/route.ts           # GET → upstream /v1/products
  products/[id]/route.ts      # GET → upstream /v1/products/:id
```

---

## 1. `services/catalog-api/package.json`

```json
{
  "name": "catalog-api",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/node-server": "^1.19.7",
    "dotenv": "^17.4.2",
    "hono": "^4.11.4",
    "tsx": "^4.21.0"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "typescript": "^6.0.3"
  }
}
```

Note: **`tsx` in `dependencies`** so production Docker images can run without a separate build step.

---

## 2. `services/catalog-api/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "../../src/domain/product.ts"]
}
```

---

## 3. `services/catalog-api/src/catalogStore.ts`

Default catalog path when the process cwd is `services/catalog-api`: `../../data/catalog.generated.5000.json`. Override with `CATALOG_SEED_PATH` (relative to cwd).

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Catalog, Product } from "../../../src/domain/product.js";
import { parseCatalog } from "../../../src/domain/product.js";

function catalogPathFromEnv(): string {
  const rel = process.env.CATALOG_PATH?.trim();
  if (rel) return join(process.cwd(), rel);
  return join(process.cwd(), "..", "..", "data", "catalog.json");
}

let cached: { path: string; catalog: Catalog } | null = null;

export function loadCatalog(): Catalog {
  const path = catalogPathFromEnv();
  if (cached?.path === path) return cached.catalog;
  const raw = readFileSync(path, "utf-8");
  const catalog = parseCatalog(JSON.parse(raw) as unknown);
  cached = { path, catalog };
  return catalog;
}

export function listProducts(query?: string): Product[] {
  const { products } = loadCatalog();
  const q = query?.trim().toLowerCase();
  if (!q) return products;
  return products.filter(
    (p) =>
      p.id.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q),
  );
}

export function getProductById(id: string): Product | undefined {
  return loadCatalog().products.find((p) => p.id === id);
}
```

---

## 4. `services/catalog-api/src/server.ts`

```typescript
import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getProductById, listProducts, loadCatalog } from "./catalogStore.js";

const app = new Hono();

const allowOrigin = process.env.CATALOG_CORS_ORIGIN?.trim() || "*";

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

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "catalog-api",
    productCount: loadCatalog().products.length,
  }),
);

app.get("/v1/products", (c) => {
  const q = c.req.query("q");
  const products = listProducts(q);
  return c.json({ products, count: products.length });
});

app.get("/v1/products/:id", (c) => {
  const id = c.req.param("id");
  const product = getProductById(id);
  if (!product) return c.json({ error: "Not found" }, 404);
  return c.json({ product });
});

const port = Number.parseInt(process.env.PORT || "4001", 10);
const host = process.env.HOST?.trim() || "0.0.0.0";

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`catalog-api listening on http://${info.address}:${info.port}`);
});
```

---

## 5. `services/catalog-api/Dockerfile`

Build context = **repository root**.

```dockerfile
FROM node:22-alpine
WORKDIR /app

COPY src/domain/product.ts ./src/domain/product.ts
COPY data ./data
COPY services/catalog-api/package.json ./services/catalog-api/
COPY services/catalog-api/tsconfig.json ./services/catalog-api/
COPY services/catalog-api/src ./services/catalog-api/src

WORKDIR /app/services/catalog-api
RUN npm install --omit=dev

ENV NODE_ENV=production
ENV PORT=4001
ENV HOST=0.0.0.0
ENV CATALOG_SEED_PATH=../../data/catalog.generated.5000.json

EXPOSE 4001
CMD ["npx", "tsx", "src/server.ts"]
```

---

## 6. `src/integrations/catalogApiClient.ts` (Next server / Node only)

```typescript
import type { Product } from "../domain/product.js";

export type CatalogProductsResponse = {
  products: Product[];
  count: number;
};

export type CatalogProductResponse = {
  product: Product;
};

function baseUrl(): string {
  const u = process.env.CATALOG_API_BASE_URL?.trim();
  if (!u) {
    throw new Error(
      "Missing CATALOG_API_BASE_URL. Set it to your catalog-api origin, e.g. http://127.0.0.1:4001",
    );
  }
  return u.replace(/\/$/, "");
}

function authHeaders(): HeadersInit {
  const t = process.env.CATALOG_API_TOKEN?.trim();
  if (!t) return {};
  return { Authorization: `Bearer ${t}` };
}

export async function fetchCatalogProducts(
  searchParams: URLSearchParams,
): Promise<CatalogProductsResponse> {
  const q = new URLSearchParams(searchParams);
  const url = `${baseUrl()}/v1/products?${q.toString()}`;
  const res = await fetch(url, { headers: authHeaders(), next: { revalidate: 0 } });
  if (!res.ok) {
    throw new Error(`catalog-api GET /v1/products failed: ${res.status}`);
  }
  return (await res.json()) as CatalogProductsResponse;
}

export async function fetchCatalogProduct(
  id: string,
): Promise<CatalogProductResponse | null> {
  const enc = encodeURIComponent(id);
  const url = `${baseUrl()}/v1/products/${enc}`;
  const res = await fetch(url, { headers: authHeaders(), next: { revalidate: 0 } });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`catalog-api GET /v1/products/${id} failed: ${res.status}`);
  }
  return (await res.json()) as CatalogProductResponse;
}
```

---

## 7. BFF routes

### `app/api/catalog/v1/products/route.ts`

From `app/api/catalog/v1/products/route.ts`, go up **5** segments (`..` × 5) to the repo root, then `src/integrations/...`.

```typescript
import { NextResponse } from "next/server";
import { fetchCatalogProducts } from "../../../../../src/integrations/catalogApiClient";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const data = await fetchCatalogProducts(url.searchParams);
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("Missing CATALOG_API_BASE_URL") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
```

### `app/api/catalog/v1/products/[id]/route.ts`

From `app/api/catalog/v1/products/[id]/route.ts`, go up **6** segments to the repo root.

```typescript
import { NextResponse } from "next/server";
import { fetchCatalogProduct } from "../../../../../../src/integrations/catalogApiClient";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const data = await fetchCatalogProduct(decodeURIComponent(id));
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("Missing CATALOG_API_BASE_URL") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
```

---

## 8. Root `package.json` scripts (optional)

```json
"dev:catalog-api": "npm run dev --prefix services/catalog-api"
```

---

## 9. Environment (root `.env` for Next)

| Variable | Where | Purpose |
|----------|--------|---------|
| `CATALOG_API_BASE_URL` | Next server | Origin of catalog-api (e.g. `http://127.0.0.1:4001`) |
| `CATALOG_API_TOKEN` | Next + catalog-api | Shared bearer if token auth enabled on catalog-api |

Do **not** expose `CATALOG_API_BASE_URL` to the client as a public env var if the token must stay secret; keep reads in Route Handlers only (this design does).

---

## 10. Follow-ups (not in initial slice)

- Point **RAG index** at the same service (refresh embeddings when catalog-api version changes), or keep file-based index and use BFF only for **live** lookups.
- Add **Zod** validation on BFF query params.
- **Health** proxy `GET /api/catalog/health` → upstream `/health` for synthetic checks.

---

## README correction (`services/catalog-api/README.md`)

When developers run `cd services/catalog-api && npm run dev`, **cwd** is `services/catalog-api`; the default catalog seed path must be `../../data/catalog.generated.5000.json`, not `data/catalog.generated.5000.json` at repo root unless you always start the process from the repo root via a root script.
