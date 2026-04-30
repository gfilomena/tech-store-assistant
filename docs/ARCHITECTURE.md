## Tech Store RAG Chat — Architecture

**High-level picture (no file paths):** open [`architecture-overview.svg`](./architecture-overview.svg) in a browser or any SVG viewer, or embed it in slides.

This project is a **Next.js web UI** backed by a **server-side RAG pipeline** (retrieval + grounded generation) using the OpenAI SDK. The client never sees your `OPENAI_API_KEY`.

### High-level diagram

```mermaid
flowchart TD
  Browser["Browser<br/>Chat UI (src/ui/ChatUI.tsx)"] -->|POST + SSE stream| Api["Next.js Route Handler<br/>POST /api/chat<br/>(app/api/chat/route.ts)"]

  subgraph Server[Server-side pipeline]
    Api --> Rate["Rate limit + input caps"]
    Rate --> Mod["Optional moderation + insult filter"]
    Mod --> Index["getEmbeddedChunksSingleton<br/>(src/rag/indexSingleton.ts)"]
    Index -->|may read/write| DiskCache["data/cache/embeddedChunks.(hash).json<br/>(optional, RAG_EMBED_CACHE=1)"]
    Index --> Embed["Embeddings (OpenAI)<br/>OPENAI_EMBEDDING_MODEL (default: text-embedding-3-small)"]
    Embed --> Retrieve["Retrieve top-k (cosine)<br/>(src/rag/retrieve.ts)"]
    Retrieve --> Prompt["Prompt + guidance schema<br/>(src/rag/answerStoreQuestion.ts)"]
    Prompt --> LLM["OpenAI Chat Completions<br/>(streaming tokens)"]
    LLM --> Api
  end

  subgraph Data[Project data]
    Catalog["data/catalog.generated.5000.json"]
    Scenarios["data/support-scenarios.json"]
  end

  Catalog --> Index
  Scenarios --> Browser
```

### Speech-to-text (optional voice input)

The UI can use the browser’s Web Speech API, and (when needed) falls back to server-side transcription:
- `POST /api/speech/transcribe` (`app/api/speech/transcribe/route.ts`) accepts a short audio clip (`multipart/form-data`) and transcribes it with OpenAI (`OPENAI_TRANSCRIPTION_MODEL`, default `whisper-1`).

### Catalog service + BFF (tech products)

Tech products are stored in **SQLite** by the **catalog REST service** ([`services/catalog-api`](../services/catalog-api)). On first start (or when `CATALOG_FORCE_RESEED=1`) it **seeds** from [`data/catalog.generated.5000.json`](../data/catalog.generated.5000.json) into `data/catalog.sqlite` (override with `CATALOG_SEED_PATH` and `CATALOG_DB_PATH`). It can also enrich products with `inStock` using **Redis** (optional) when `REDIS_URL` / `CATALOG_REDIS_URL` is set.

Next.js proxies the service under **`/api/catalog/v1/*`** using **`CATALOG_API_BASE_URL`** (server-only). See [CATALOG_SERVICE_AND_BFF.md](./CATALOG_SERVICE_AND_BFF.md).

```mermaid
flowchart LR
  Browser --> NextBFF["Next BFF<br/>/api/catalog/v1/*"]
  NextBFF --> CatalogSvc["catalog-api<br/>/v1/catalog<br/>/v1/categories<br/>/v1/products<br/>/v1/products/:id"]
  subgraph Optional[Optional split deploy]
    CatalogSvc
  end
```

### Key components
- **UI**: `src/ui/ChatUI.tsx`
  - Streams assistant output (SSE) into a single message bubble.
  - Shows guided “tree” suggestions at the start of the chat.
  - Has a **New chat** button that aborts in-flight requests and clears state.
  - Displays a deterministic **relevance/confidence** score returned by the server.

- **API**: `app/api/chat/route.ts`
  - Rate limiting + input caps
  - Optional moderation (`RAG_USE_MODERATION=1`)
  - RAG retrieval + streaming response via SSE

- **RAG core**: `src/rag/answerStoreQuestion.ts`
  - Retrieval confidence gate (`RAG_MIN_SCORE`)
  - “Guidance JSON” parsing to return structured clarifiers + suggested next questions
  - Prompt-injection guardrail (treat retrieved context as untrusted)

- **Index caching**: `src/rag/indexSingleton.ts`
  - In-memory singleton per warm server instance
  - Optional disk cache: `RAG_EMBED_CACHE=1` writes `data/cache/embeddedChunks.<hash>.json` (hash = catalog content + embedding model)

### Image export (optional)
If you specifically need a PNG image, you can export the Mermaid diagram using:
- VS Code / Cursor Mermaid preview export, or
- GitHub rendering screenshot, or
- Mermaid CLI (mmdc).

