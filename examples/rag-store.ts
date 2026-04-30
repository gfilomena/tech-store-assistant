import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCatalog } from "../src/domain/product.js";
import { getOpenAIClient } from "../src/openaiClient.js";
import { answerStoreQuestion } from "../src/rag/answerStoreQuestion.js";
import { buildEmbeddedIndex } from "../src/rag/embedChunks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogRel =
  process.env.RAG_CATALOG_PATH?.trim() || join("data", "catalog.generated.5000.json");
const catalogPath = join(__dirname, "..", catalogRel);

const questionArg = process.argv.slice(2).join(" ").trim();
if (!questionArg) {
  console.error(
    'Usage: npm run dev:rag -- "Your question about TVs, phones, or appliances"',
  );
  console.error('Tip: set RAG_CATALOG_PATH="data/catalog.generated.5000.json" (or another JSON catalog).');
  process.exit(1);
}

const raw = readFileSync(catalogPath, "utf-8");
const catalog = parseCatalog(JSON.parse(raw) as unknown);

const client = getOpenAIClient();
const embeddingModel =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

console.error(`Indexing ${catalog.products.length} products (embeddings: ${embeddingModel})...`);
const embeddedChunks = await buildEmbeddedIndex(client, catalog, embeddingModel);

const answer = await answerStoreQuestion(client, embeddedChunks, {
  question: questionArg,
});

console.log(answer.answer);
console.error("\n--- sources ---");
for (const s of answer.sources) {
  console.error(`${s.chunkId}  score=${s.score.toFixed(4)}  product=${s.productId}`);
}
