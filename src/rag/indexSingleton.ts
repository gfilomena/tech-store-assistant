import type OpenAI from "openai";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { EmbeddedChunk } from "../domain/product";
import { parseCatalog } from "../domain/product";
import { getRagCatalogRelPath } from "./catalogMeta";
import { buildEmbeddedIndex } from "./embedChunks";

type IndexState = {
  embeddedChunks: EmbeddedChunk[] | null;
  embeddingModel: string | null;
  catalogRelPath: string | null;
  building: Promise<EmbeddedChunk[]> | null;
};

const globalKey = "__ragEmbeddedIndexState__";

function getState(): IndexState {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[globalKey]) {
    g[globalKey] = {
      embeddedChunks: null,
      embeddingModel: null,
      catalogRelPath: null,
      building: null,
    } satisfies IndexState;
  }
  return g[globalKey] as IndexState;
}

function getCatalogRelPath(): string {
  return getRagCatalogRelPath();
}

function readCatalogJson(catalogRelPath: string) {
  const p = join(process.cwd(), catalogRelPath);
  const raw = readFileSync(p, "utf-8");
  return parseCatalog(JSON.parse(raw) as unknown);
}

function shouldUseDiskCache(): boolean {
  const raw = process.env.RAG_EMBED_CACHE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function cacheFilePath(catalogRelPath: string, embeddingModel: string): string {
  const abs = join(process.cwd(), catalogRelPath);
  const content = readFileSync(abs, "utf-8");
  const hash = createHash("sha256")
    .update(content)
    .update("\n")
    .update(embeddingModel)
    .digest("hex")
    .slice(0, 16);
  return join(process.cwd(), "data", "cache", `embeddedChunks.${hash}.json`);
}

function tryReadDiskCache(path: string): EmbeddedChunk[] | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as EmbeddedChunk[];
  } catch {
    return null;
  }
}

function tryWriteDiskCache(path: string, embedded: EmbeddedChunk[]) {
  try {
    mkdirSync(join(process.cwd(), "data", "cache"), { recursive: true });
    writeFileSync(path, JSON.stringify(embedded), "utf-8");
  } catch {
    // best-effort cache
  }
}

/**
 * RAG ingestion/runtime: build (once) and reuse the embedded catalog index for this server instance.
 * Optionally persists a content-hashed cache file when `RAG_EMBED_CACHE=1`.
 */
export async function getEmbeddedChunksSingleton(
  client: OpenAI,
  embeddingModel: string,
): Promise<EmbeddedChunk[]> {
  const state = getState();
  const catalogRelPath = getCatalogRelPath();

  if (
    state.embeddedChunks &&
    state.embeddingModel === embeddingModel &&
    state.catalogRelPath === catalogRelPath
  ) {
    // eslint-disable-next-line no-console
    console.log(
      `[rag][index] memory cache hit catalog=${catalogRelPath} model=${embeddingModel} chunks=${state.embeddedChunks.length}`,
    );
    return state.embeddedChunks;
  }

  if (state.building) {
    // eslint-disable-next-line no-console
    console.log(
      `[rag][index] await in-flight build catalog=${catalogRelPath} model=${embeddingModel}`,
    );
    return state.building;
  }

  state.catalogRelPath = catalogRelPath;
  state.embeddingModel = embeddingModel;
  state.building = (async () => {
    const diskCacheOn = shouldUseDiskCache();
    const diskCachePath = diskCacheOn ? cacheFilePath(catalogRelPath, embeddingModel) : null;
    if (diskCachePath) {
      const cached = tryReadDiskCache(diskCachePath);
      if (cached?.length) {
        // eslint-disable-next-line no-console
        console.log(
          `[rag][index] disk cache hit path=${diskCachePath} chunks=${cached.length}`,
        );
        state.embeddedChunks = cached;
        state.building = null;
        return cached;
      }
      // eslint-disable-next-line no-console
      console.log(`[rag][index] disk cache miss path=${diskCachePath}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[rag][index] disk cache disabled (set RAG_EMBED_CACHE=1 to enable)`);
    }

    const startedAt = Date.now();
    // eslint-disable-next-line no-console
    console.log(
      `[rag][index] building embedded index catalog=${catalogRelPath} model=${embeddingModel}...`,
    );
    const catalog = readCatalogJson(catalogRelPath);
    const embeddedChunks = await buildEmbeddedIndex(client, catalog, embeddingModel);
    if (diskCachePath) tryWriteDiskCache(diskCachePath, embeddedChunks);
    // eslint-disable-next-line no-console
    console.log(
      `[rag][index] built embedded index chunks=${embeddedChunks.length} elapsed=${Date.now() - startedAt}ms`,
    );
    state.embeddedChunks = embeddedChunks;
    state.building = null;
    return embeddedChunks;
  })().catch((err) => {
    state.building = null;
    throw err;
  });

  return state.building;
}

