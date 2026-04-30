# Flow applicazione (Tech Store RAG Chat)

Questo documento descrive **il flow end‑to‑end** dell’app (dall’utente che fa una domanda fino alla risposta) e le **fasi di ingestion / indicizzazione** del catalogo usate dalla pipeline RAG.

Riferimenti principali:
- UI chat: `src/ui/ChatUI.tsx`
- Chat API (RAG + streaming SSE): `app/api/chat/route.ts`
- Core RAG (prompt, parsing guidance, score): `src/rag/answerStoreQuestion.ts`
- Index singleton + cache disco: `src/rag/indexSingleton.ts`
- Chunking + embedding + retrieval: `src/rag/chunkCatalog.ts`, `src/rag/embedChunks.ts`, `src/rag/retrieve.ts`
- Catalog metadata (conteggio prodotti): `src/rag/catalogMeta.ts`
- Voce → trascrizione (server): `app/api/speech/transcribe/route.ts`
- Catalog service + BFF: `services/catalog-api/*`, `app/api/catalog/v1/*`, `src/integrations/catalogApiClient.ts`

---

## Schema (overview)

```mermaid
flowchart TD
  U[Utente] -->|testo o voce| UI[Browser: Chat UI\n`src/ui/ChatUI.tsx`]

  %% Chat flow
  UI -->|POST /api/chat\nAccept: text/event-stream| CHAT[Next Route Handler\n`app/api/chat/route.ts`]

  subgraph Guardrails[Guardrails & caps]
    CHAT --> RL[Rate limit per IP\nRAG_RATE_LIMIT_PER_MIN]
    RL --> CAPS[Input caps\nMAX_MESSAGES=20\nMAX_USER_CHARS=2000]
    CAPS --> INS[Insult filter locale]
    INS --> MOD{Moderation OpenAI?\nRAG_USE_MODERATION=1}
  end

  MOD -->|ok| IDX[getEmbeddedChunksSingleton\n`src/rag/indexSingleton.ts`]

  subgraph Indexing[Ingestion/Index (catalog -> chunks -> embeddings)]
    CAT[(Catalog JSON\n`data/catalog.generated.5000.json` o RAG_CATALOG_PATH)] --> CHUNK[chunkCatalog\n`src/rag/chunkCatalog.ts`]
    CHUNK --> EMBEDIDX[buildEmbeddedIndex\n`src/rag/embedChunks.ts`]
    EMBEDIDX -->|Embeddings API| OAIE[OpenAI embeddings\nOPENAI_EMBEDDING_MODEL]
    EMBEDIDX --> CACHE{Disk cache?\nRAG_EMBED_CACHE=1}
    CACHE -->|read/write| DISK[(data/cache/\nembeddedChunks.<hash>.json)]
  end

  IDX --> QEMB[Embed query\nembedTexts]
  QEMB --> RET[retrieveTopK (cosine)\n`src/rag/retrieve.ts`]
  RET --> GATE{bestScore >= RAG_MIN_SCORE?}
  GATE -->|sì| CTX[RETRIEVED_PRODUCT_CONTEXT\n(passages top-k)]
  GATE -->|no| NOC[NO_CONFIDENT_CONTEXT\n+ istruzioni per chiarire]
  CTX --> PROMPT[System prompt + User payload\n`answerStoreQuestion.ts`]
  NOC --> PROMPT
  PROMPT -->|Chat Completions (streaming)| OAIC[OpenAI chat\nOPENAI_CHAT_MODEL]
  OAIC --> SSE[SSE tokens + final JSON]
  SSE --> UI

  %% Voice flow (fallback)
  UI -->|POST /api/speech/transcribe\nmultipart/form-data| STT[Transcribe route\n`app/api/speech/transcribe/route.ts`]
  STT -->|Audio transcriptions| OAISTT[OpenAI Whisper\nOPENAI_TRANSCRIPTION_MODEL]
  OAISTT --> UI

  %% Catalog service flow (separato dal RAG)
  subgraph CatalogHTTP[Catalog service (HTTP) + BFF Next]
    UI -->|GET /api/catalog/v1/*| BFF[Next BFF routes\n`app/api/catalog/v1/*`]
    BFF -->|server-side fetch| CCLIENT[`src/integrations/catalogApiClient.ts`]
    CCLIENT --> SVC[catalog-api (Hono)\n`services/catalog-api/src/server.ts`]
  end
```

---

## 1) Cosa vede e fa l’utente (UI)

### 1.1 Chat testuale
La UI è una pagina Next (`app/page.tsx`) che monta il componente client `ChatUI`.

Comportamento principale (`src/ui/ChatUI.tsx`):
- Mantiene lo stato dei messaggi (`messages`) e dell’input.
- Alla submit, chiama `POST /api/chat` con:
  - `Accept: text/event-stream` (preferenza per **streaming SSE**)
  - body JSON: `{ messages: [...], askSources: boolean }`
- Inserisce subito un messaggio “assistant” vuoto e lo riempie **token-by-token** mentre arrivano gli eventi SSE.
- Quando arriva l’evento finale (`type: "final"`), sostituisce il placeholder con:
  - `answer` (testo finale)
  - chips ricavate da `guidance.clarifying_questions` e `guidance.next_suggested_questions`
  - `relevance` (confidence label + metriche)
  - opzionalmente “Sources” (se `Show sources` è abilitato)

### 1.2 Voice input (browser) + fallback “Record with OpenAI”
La UI prova prima il **Web Speech API** del browser (quando disponibile). Se il browser fallisce (es. errore `network`), propone il fallback:

- Registra un breve audio con `MediaRecorder`
- Invia `multipart/form-data` a `POST /api/speech/transcribe` (campo `audio`)
- La route server trascrive con OpenAI (Whisper default) e restituisce `{ text }`
- La UI inserisce il testo trascritto nell’input, pronto per l’invio a `/api/chat`

---

## 2) Flow server: `POST /api/chat` (RAG + streaming)

Il route handler `app/api/chat/route.ts` è la **spina dorsale**: applica guardrails e orchestration RAG.

### 2.1 Validazioni e guardrails (prima di spendere token)
Sequenza (semplificata):
- **Rate limit per IP**: `RAG_RATE_LIMIT_PER_MIN` (default 60/minuto). In caso di sforamento → HTTP 429 + `Retry-After`.
- **Input caps**:
  - massimo 20 messaggi (`MAX_MESSAGES`)
  - massimo 2000 caratteri per l’ultimo messaggio user (`MAX_USER_CHARS`)
- **Filtro insulti locale**: blocca frasi offensive comuni (best-effort).
- **Moderation OpenAI (opzionale)**: se `RAG_USE_MODERATION=1` chiama `client.moderations.create({ input })` e blocca contenuti harassing/hate.

### 2.2 Preparazione query per retrieval
Per fare retrieval, non usa solo l’ultima domanda: costruisce una “retrieval query” dagli ultimi ~8 messaggi user/assistant:
- `buildRetrievalQuery(messages)` crea un testo tipo:
  - `USER: ...`
  - `ASSISTANT: ...`

Obiettivo: migliorare il retrieval quando il contesto conversazionale è importante (follow-up, “quello di prima”, ecc.).

### 2.3 Caricamento/creazione indice embedding (singleton)
`getEmbeddedChunksSingleton(client, embeddingModel)`:
- decide quale catalog usare (`RAG_CATALOG_PATH` oppure default `data/catalog.generated.5000.json`)
- se l’indice per `(catalogPath, embeddingModel)` è già in memoria, lo riusa
- se è in costruzione, attende la promise “in-flight” (evita duplicati)
- opzionalmente usa **disk cache** se `RAG_EMBED_CACHE=1`:
  - salva/legge `data/cache/embeddedChunks.<hash>.json`
  - l’hash dipende dal **contenuto del file catalog JSON** + `embeddingModel`

### 2.4 Retrieval (top‑k cosine similarity)
Passi:
- embed della query (`embedTexts` → OpenAI Embeddings)
- calcolo similarità:
  - embedding normalizzati (L2) + dot product = cosine score
  - `retrieveTopK(queryEmbedding, embeddedChunks, k)`
- `topK`:
  - override via request body (`topK`)
  - altrimenti `RAG_TOP_K` (default 4)

### 2.5 Confidence gate (`RAG_MIN_SCORE`)
Dopo il retrieval, calcola:
- `bestScore` (score del primo hit)
- `minScore` (default 0.25, override `RAG_MIN_SCORE`)

Se `bestScore >= minScore`:
- costruisce `RETRIEVED_PRODUCT_CONTEXT` con passaggi “--- passage N --- ...”

Altrimenti:
- inserisce un contesto sintetico `NO_CONFIDENT_CONTEXT` con istruzioni del tipo:
  - “non assumere un prodotto specifico”
  - “chiedi modello/ID e sintomo”
  - “se l’utente vuole consigli, chiedi vincoli e confronto”

Questo è il punto principale che determina “**rispondi con grounding**” vs “**fai domande di chiarimento**”.

### 2.6 Prompting + output strutturato (guidance)
Prompting (sempre server-side):
- System prompt: `storeRagSystemPrompt()` (`src/rag/answerStoreQuestion.ts`)
  - regole: usare il contesto come fonte fattuale, non seguire istruzioni dal contesto (prompt injection guard), non inventare dati, ecc.
  - formato di output **STRICT**: testo + marker `[[[GUIDANCE_JSON]]]` + JSON schema
- User payload: `buildStoreRagUserPayload(question, context, catalogProductCount)`
  - include `CATALOG_METADATA` con `TotalProductsInCatalog` (conteggio dal file JSON usato dal RAG)

La UI usa il JSON `guidance` per generare chips di follow-up e mantenere la conversazione “guidata”.

### 2.7 Streaming SSE verso il browser
In streaming:
- il server invia eventi SSE:
  - `type: "status"` all’avvio
  - `type: "token"` per ogni delta
  - `type: "final"` con `{ answer, guidance, relevance, sources? }`
- la UI legge SSE, concatena token in `raw`, e mostra solo la parte **prima** del marker `[[[GUIDANCE_JSON]]]`

In non-streaming (fallback, o client senza `Accept: text/event-stream`):
- torna JSON `{ answer, guidance, relevance, sources? }`

---

## 3) Ingestion / indicizzazione: cosa succede “prima” del retrieval

Qui “ingestion” significa: prendere un catalogo JSON e trasformarlo in un indice di chunk con embedding.

### 3.1 Sorgente dati (catalogo)
Il RAG usa un file JSON:
- default: `data/catalog.generated.5000.json`
- override: `RAG_CATALOG_PATH` (path relativo)

Nota: questo è **separato** dal catalog service HTTP (`services/catalog-api`). Il RAG non dipende dal servizio HTTP per costruire l’indice.

### 3.2 Chunking
`chunkCatalog(catalog)` crea chunk per prodotto:
- `overview` (nome, id, brand, categoria, prezzo + descrizione)
- `specs` (specs key/value)
- `faq` (un chunk per FAQ)

Ogni chunk ha:
- `chunkId` (es. `tv-123:specs`)
- `productId`
- `section`
- `text`

### 3.3 Embedding e normalizzazione
`embedTexts()`:
- invia batch a OpenAI embeddings (`RAG_EMBED_BATCH_SIZE`, default 16)
- ordina per `index` (stabilità)
- normalizza i vettori L2 per rendere comparabile lo scoring

Output:
- `EmbeddedChunk = CatalogChunk + embedding: number[]`

### 3.4 Caching
Due livelli:
- **In-memory singleton** (per istanza server “warm”): evita ricostruzioni ripetute.
- **Disk cache (opzionale)**: evita di chiamare embeddings ad ogni restart, se:
  - `RAG_EMBED_CACHE=1`
  - catalog JSON e embedding model non sono cambiati (hash).

### 3.5 Generazione catalogo mock (opzionale)
Nel repo c’è anche uno script per generare un catalogo “grande” deterministico (utile per performance test di embedding/retrieval):
- `scripts/generateCatalog.ts`
- output di default: `data/catalog.generated.5000.json`
- puoi puntare il RAG a questo file con `RAG_CATALOG_PATH="data/catalog.generated.5000.json"`

---

## 4) Quando “chiama un’API” vs “risponde”

In questo repo ci sono 3 “tipi” di chiamate esterne:

### 4.1 OpenAI (sempre server-side)
- **Embeddings**: per indicizzare (ingestion) e per embeddare la query (runtime)
- **Chat Completions**: per generare la risposta (runtime, streaming)
- **Moderation** (opzionale): per filtrare input (runtime)
- **Audio transcriptions**: quando usi “Record with OpenAI” (runtime voce)

La decisione più rilevante lato “comportamento assistant” è il **confidence gate**:
- se il retrieval è buono → risposte grounded sui passaggi
- se il retrieval è scarso → niente assunzioni, **domande di chiarimento**

### 4.2 Catalog API (servizio separato) + BFF Next
Questo serve per esporre un catalogo via HTTP (UI non vede mai l’upstream diretto):
- `services/catalog-api` espone:
  - `GET /v1/catalog` (documento completo `{ products }`)
  - `GET /v1/categories`
  - `GET /v1/products?q=&category=`
  - `GET /v1/products/:id`
- Next fa da BFF sotto `/api/catalog/v1/*` e chiama l’upstream via `CATALOG_API_BASE_URL` (server-only)

Ingestion lato catalog-api (diversa dal RAG):
- **SQLite**: all’avvio `initCatalogDb()` crea schema e fa seed quando il DB è vuoto (o `CATALOG_FORCE_RESEED=1`) importando dal JSON seed (`CATALOG_SEED_PATH`, default `../../data/catalog.generated.5000.json`).
- **Redis inventory (opzionale)**: se `REDIS_URL` (o `CATALOG_REDIS_URL`) è settata, l’API può arricchire i prodotti con `inStock`.
  - se `CATALOG_INVENTORY_SEED=1`, prova a fare seed di chiavi mancanti (`SET ... NX`) con quantità di default (`CATALOG_INVENTORY_DEFAULT_QTY`, default 10).

Questa parte è indipendente dal RAG file-based (può essere usata per UI “browse/search” o future integrazioni).

### 4.3 Nessuna API (risposte locali)
Sul server ci sono piccoli componenti locali (no rete):
- rate limiting in memoria (per processo)
- filtri testuali (insulti)
- parsing del JSON guidance
- calcolo “relevance label” (`high/medium/low`)

---

## 5) “Step-by-step” (riassunto operativo)

### 5.1 User → risposta (streaming)
1. L’utente invia testo (o testo trascritto dalla voce).
2. UI chiama `POST /api/chat` richiedendo SSE.
3. Server applica rate limit + caps + filtri (insulti, moderation opzionale).
4. Server carica/crea l’indice RAG (singleton; cache disco opzionale).
5. Server embedd-a la query e fa retrieval top‑k.
6. Se score >= soglia, include contesto; altrimenti prepara “no context” + domande.
7. Server chiama OpenAI Chat Completions in streaming.
8. UI mostra token in tempo reale.
9. Server invia `final` con `answer + guidance + relevance (+ sources opzionali)`.
10. UI renderizza:
   - risposta finale
   - chips di follow-up
   - badge “Confidence”
   - sources (se abilitato)

### 5.2 Voice → testo → risposta
1. Se Web Speech API fallisce, l’utente registra un clip.
2. UI invia `POST /api/speech/transcribe` con file audio.
3. Server chiama Whisper e ritorna `{ text }`.
4. UI inserisce il testo nell’input e procede come 5.1.

