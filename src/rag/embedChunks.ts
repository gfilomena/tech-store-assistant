import type OpenAI from "openai";
import type { Catalog, CatalogChunk, EmbeddedChunk } from "../domain/product";
import { chunkCatalog } from "./chunkCatalog";
import { normalizeVector } from "./similarity";

const DEFAULT_BATCH = 16;

function getBatchSize(): number {
  const raw = process.env.RAG_EMBED_BATCH_SIZE;
  if (!raw) return DEFAULT_BATCH;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BATCH;
}

/**
 * Embed many texts in batches; returns chunks with L2-normalized embeddings for retrieval.
 */
export async function embedTexts(
  client: OpenAI,
  texts: string[],
  model: string,
): Promise<number[][]> {
  const batchSize = getBatchSize();
  const totalBatches = Math.max(1, Math.ceil(texts.length / batchSize));
  const logEvery = Math.max(1, Math.ceil(totalBatches / 20)); // ~20 progress lines max
  const startedAt = Date.now();
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batchIndex = Math.floor(i / batchSize) + 1;
    if (batchIndex === 1 || batchIndex % logEvery === 0 || batchIndex === totalBatches) {
      const elapsedMs = Date.now() - startedAt;
      // eslint-disable-next-line no-console
      console.log(
        `[rag][embed] model=${model} batch ${batchIndex}/${totalBatches} (size=${Math.min(
          batchSize,
          texts.length - i,
        )}) elapsed=${elapsedMs}ms`,
      );
    }
    const batch = texts.slice(i, i + batchSize);
    const res = await client.embeddings.create({
      model,
      input: batch,
    });
    const vectors = res.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => normalizeVector(d.embedding as number[]));
    all.push(...vectors);
  }
  // eslint-disable-next-line no-console
  console.log(
    `[rag][embed] done model=${model} vectors=${all.length} elapsed=${Date.now() - startedAt}ms`,
  );
  return all;
}

/** RAG ingestion: embed pre-built catalog chunks into `EmbeddedChunk[]` (chunk metadata + embedding vector). */
export async function embedChunks(
  client: OpenAI,
  chunks: CatalogChunk[],
  model: string,
): Promise<EmbeddedChunk[]> {
  if (chunks.length === 0) return [];
  const texts = chunks.map((c) => c.text);
  const vectors = await embedTexts(client, texts, model);
  return chunks.map((chunk, index) => ({
    ...chunk,
    embedding: vectors[index]!,
  }));
}

/** RAG ingestion: end-to-end builder (catalog JSON -> chunk -> embeddings) used by the index singleton. */
export async function buildEmbeddedIndex(
  client: OpenAI,
  catalog: Catalog,
  embeddingModel: string,
): Promise<EmbeddedChunk[]> {
  const chunks = chunkCatalog(catalog);
  // eslint-disable-next-line no-console
  console.log(
    `[rag][index] chunked catalog products=${catalog.products.length} chunks=${chunks.length}`,
  );
  return embedChunks(client, chunks, embeddingModel);
}
