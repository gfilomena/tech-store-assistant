# Catalog API — tech products

Standalone HTTP service that exposes the **catalog JSON shape**: root object with a `products` array; each item matches [`src/domain/product.ts`](../../src/domain/product.ts) (`id`, `name`, `category`, `brand`, `price`, `currency`, `description`, `specs`, optional `faqs`).

**SQLite** holds product rows. On first start (empty DB), the API **seeds** from **`../../data/catalog.generated.5000.json`** (relative to this package when `cwd` is `services/catalog-api`). Override with `CATALOG_SEED_PATH`. Set **`CATALOG_FORCE_RESEED=1`** to truncate and re-import.

**Redis (optional)** holds **inventory counts** keyed by product id. When configured, product payloads include `inStock` (integer). Catalog metadata still comes from SQLite.

## Run locally

```bash
cd services/catalog-api
npm install
npm run dev
```

Or from repo root: `npm run dev:catalog-api`

Default URL: `http://127.0.0.1:4001`

### Optional: Redis for inventory

Run Redis locally (example):

```bash
docker run --rm -p 6379:6379 redis:7-alpine
```

Then set `REDIS_URL` (see environment table below). To populate missing keys on startup:

- `CATALOG_INVENTORY_SEED=1`

## Environment

| Variable | Description |
|----------|-------------|
| `PORT` | Listen port (default `4001`) |
| `HOST` | Bind address (default `0.0.0.0`) |
| `CATALOG_DB_PATH` | SQLite file relative to **cwd** (default `../../data/catalog.sqlite`) |
| `CATALOG_SEED_PATH` | Catalog JSON for initial seed (default `../../data/catalog.generated.5000.json`) |
| `CATALOG_FORCE_RESEED` | Set to `1` to delete all rows and re-seed from `CATALOG_SEED_PATH` on startup |
| `REDIS_URL` | Redis connection URL for inventory (example: `redis://127.0.0.1:6379`) |
| `CATALOG_REDIS_URL` | Alias for `REDIS_URL` |
| `CATALOG_INVENTORY_KEY_PREFIX` | Key prefix for inventory strings (default `catalog:inventory`) |
| `CATALOG_INVENTORY_SEED` | Set to `1` to `SET key value NX` for every product id on startup (won’t overwrite existing keys) |
| `CATALOG_INVENTORY_DEFAULT_QTY` | Default qty used by `CATALOG_INVENTORY_SEED` (default `10`) |
| `CATALOG_API_TOKEN` | If set, requires `Authorization: Bearer <token>` on all routes |
| `CATALOG_CORS_ORIGIN` | CORS origin(s), comma-separated, or `*` (default `*`) |

## Routes

| Method | Path | Response |
|--------|------|----------|
| GET | `/health` | `{ ok, service, productCount, inventory: { redis: { enabled, ok, error? } } }` |
| GET | `/v1/catalog` | `{ products: Product[] }` — same as catalog JSON file |
| GET | `/v1/categories` | `{ categories: string[] }` — distinct `category` values |
| GET | `/v1/products?q=&category=` | `{ products, count }` — optional text search + category filter |
| GET | `/v1/products/:id` | `{ product }` or `404` |

## Docker

From **repository root**:

```bash
docker build -f services/catalog-api/Dockerfile -t catalog-api .
docker run --rm -p 4001:4001 -e CATALOG_API_TOKEN=secret catalog-api
```

Point Next at the service with `CATALOG_API_BASE_URL` (and matching `CATALOG_API_TOKEN` if enabled). Full BFF map: [docs/CATALOG_SERVICE_AND_BFF.md](../../docs/CATALOG_SERVICE_AND_BFF.md).
