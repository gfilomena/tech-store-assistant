import { NextResponse } from "next/server";
import { getOpenAIClient } from "../../../../src/openaiClient";
import { getEmbeddedChunksSingleton } from "../../../../src/rag/indexSingleton";
import { getRagCatalogRelPath, getCatalogProductCount } from "../../../../src/rag/catalogMeta";

export const runtime = "nodejs";

export async function GET() {
  const startedAt = Date.now();
  try {
    const client = getOpenAIClient();
    const embeddingModel =
      process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
    const embedded = await getEmbeddedChunksSingleton(client, embeddingModel);
    return NextResponse.json({
      ok: true,
      catalog: getRagCatalogRelPath(),
      catalogProductCount: getCatalogProductCount(),
      embeddingModel,
      embeddedChunks: embedded.length,
      elapsedMs: Date.now() - startedAt,
      cache: process.env.RAG_EMBED_CACHE?.trim() || "0",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: message, elapsedMs: Date.now() - startedAt },
      { status: 500 },
    );
  }
}

