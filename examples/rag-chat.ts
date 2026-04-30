import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parseCatalog, type StoreLocale } from "../src/domain/product.js";
import { getOpenAIClient } from "../src/openaiClient.js";
import { buildEmbeddedIndex } from "../src/rag/embedChunks.js";
import { answerStoreQuestion } from "../src/rag/answerStoreQuestion.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogRel =
  process.env.RAG_CATALOG_PATH?.trim() || join("data", "catalog.generated.5000.json");
const catalogPath = join(__dirname, "..", catalogRel);

const locale = (process.env.RAG_LOCALE?.trim() || "it") as StoreLocale;

const client = getOpenAIClient();
const embeddingModel =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

const raw = readFileSync(catalogPath, "utf-8");
const catalog = parseCatalog(JSON.parse(raw) as unknown);

console.log(
  `Loaded catalog ${catalog.products.length} products from ${catalogRel}`,
);
console.log(`Indexing embeddings (${embeddingModel})...`);
const embeddedChunks = await buildEmbeddedIndex(client, catalog, embeddingModel);
console.log("Ready. Type your question. (exit to quit)\n");

const rl = createInterface({ input, output });

while (true) {
  const q = (await rl.question("> ")).trim();
  if (!q) continue;
  if (q.toLowerCase() === "exit" || q.toLowerCase() === "quit") break;

  const res = await answerStoreQuestion(client, embeddedChunks, {
    question: q,
    locale,
  });

  console.log(`\n${res.answer}\n`);
}

rl.close();

