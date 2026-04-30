# Tech Store Assistant (TypeScript + OpenAI)

A small Next.js + TypeScript demo of a **product assistant** that provides:

- **Pre‑purchase product information** (price/specs/compatibility/comparisons), grounded in retrieved catalog/KB context (RAG)
- **Basic post‑purchase support** (first‑line troubleshooting + clarifying questions)

Non-goals (current scope):

- Advanced repair/diagnostics without explicit KB coverage
- Guessing prices/specs/model-specific facts not present in retrieved context

## Setup

```bash
cd tech-store-assistant
npm install
cp .env.example .env
```

Edit `.env` and set `OPENAI_API_KEY`.

Optional variables for the tech-store RAG example:

- `OPENAI_EMBEDDING_MODEL` (default: `text-embedding-3-small`)
- `OPENAI_CHAT_MODEL` (default: `gpt-4.1-mini`)
- `RAG_TOP_K` (default: `4`) — number of catalog chunks injected into the prompt
- `RAG_EMBED_BATCH_SIZE` (default: `16`) — texts per embeddings API call when indexing
- `RAG_EMBED_CACHE` (recommended: `1`) — persist embeddings to `data/cache/` so the first chat after restart is fast

## Run examples

- Web UI (Next.js RAG chat):

```bash
# optional: point RAG at another catalog JSON
# export RAG_CATALOG_PATH="data/catalog.generated.5000.json"

npm run dev
```

If port **3000** is stuck from a previous run, start clean:

```bash
npm run dev:clean
```

That frees **3000** then runs `next dev`. To only kill the listener: `npm run free:3000`.

Open `http://localhost:3000` in your browser.

### Warm up RAG (avoid first-message slowdown)
On first start (or after clearing the embeddings cache), the app may need to embed the full catalog once.\n\nTo warm it up proactively:\n\n```bash\ncurl http://localhost:3000/api/rag/warmup\n```\n\nWhen it returns `{ ok: true }`, the chat endpoint should respond quickly.\n
**Voice (mic) in the chat:** uses the browser’s Web Speech API when possible. If you see a **network** error (Chrome/Edge often call a remote speech service), use **Record with OpenAI** in the banner: a short recording is sent to **`POST /api/speech/transcribe`** and transcribed with **`OPENAI_API_KEY`** (Whisper by default). You can also type your question.

### Tech product HTTP API

The catalog JSON (`{ "products": [ ... ] }` — same fields as [`src/domain/product.ts`](src/domain/product.ts)) is served by a **standalone service** and proxied through Next:

1. **Catalog service** (default seed file: [`data/catalog.generated.5000.json`](data/catalog.generated.5000.json)):

```bash
npm run dev:catalog-api
```

2. **Next.js BFF** (set `CATALOG_API_BASE_URL` in `.env`, see [`.env.example`](.env.example)):

| BFF route | Upstream |
|-----------|----------|
| `GET /api/catalog/v1/catalog` | Full `{ products }` document |
| `GET /api/catalog/v1/categories` | `{ categories }` derived from products |
| `GET /api/catalog/v1/products?q=&category=` | Filtered list + `count` |
| `GET /api/catalog/v1/products/:id` | Single `{ product }` |

Query `category` must be one of: `tv`, `smartphone`, `laptop`, `appliance`, `audio`, `wearable`.

The catalog service stores products in **SQLite** (`data/catalog.sqlite` by default), seeded once from `data/catalog.generated.5000.json` on first start. Set `CATALOG_FORCE_RESEED=1` to reload from the seed file.

Docker for the service only: `docker build -f services/catalog-api/Dockerfile -t catalog-api .` from the repo root ([`services/catalog-api/README.md`](services/catalog-api/README.md)). Mount a volume on `/app/data` to persist the DB.

- Chat Completions example:

```bash
npm run dev:chat
```

- Responses API example:

```bash
npm run dev:responses
```

- Tech-store RAG (default catalog [`data/catalog.generated.5000.json`](data/catalog.generated.5000.json) unless `RAG_CATALOG_PATH` is set; embeds chunks, answers from retrieval + catalog totals):

```bash
npm run dev:rag -- "Quale TV ha HDMI 2.1?"
```

## Demo (recommended flow)

If you want a smooth live demo, use these two commands:

```bash
# 1) Run the web chat UI
npm run dev
```

In a second terminal:

```bash
# 2) Run the curated robustness/demo prompt suite (requires OPENAI_API_KEY)
npm run demo:rag
```

The demo suite lives in `evals/rag/cases/demo.jsonl`. Add your own “showcase prompts” there.

## Deploy to Vercel (Next.js UI)

This repo can be deployed to Vercel as a **single Next.js app** (no separate `services/catalog-api` required).

- The catalog endpoints under `/api/catalog/v1/*` will serve data from the local JSON file (`data/catalog.generated.5000.json`) by default.
- If you *do* run a separate catalog service, set `CATALOG_API_BASE_URL` and the app will proxy to it instead.

Set environment variables in Vercel:

- `OPENAI_API_KEY` (required)
- `RAG_CATALOG_PATH` (optional; default `data/catalog.generated.5000.json`)
- `OPENAI_EMBEDDING_MODEL` (optional)
- `OPENAI_CHAT_MODEL` (optional)
- `CATALOG_API_BASE_URL` (optional; only if you deploy `services/catalog-api` separately)

Deploy the repo; Vercel will run `npm run build` and `npm start`.

## Run tests

Tests are mocked (no real network calls).

```bash
npm test
```

## Notes / future updates

- A more customized, problem-specific response and assistance system (guided troubleshooting flows per issue category) will be released in a future update.

