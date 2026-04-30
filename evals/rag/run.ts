import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import {
  answerStoreQuestion,
  buildStoreRagUserPayload,
  storeRagSystemPrompt,
} from "../../src/rag/answerStoreQuestion.js";
import { getEmbeddedChunksSingleton } from "../../src/rag/indexSingleton.js";
import { getCatalogProductCount } from "../../src/rag/catalogMeta.js";
import { evaluateAssistantOutput } from "./assertions.js";
import { suggestFixes } from "./suggestions.js";
import type { RagEvalCase, RagEvalResult } from "./types.js";

function readJsonl(path: string): RagEvalCase[] {
  const raw = readFileSync(path, "utf-8");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => JSON.parse(l) as RagEvalCase);
}

function stableExit(ok: boolean) {
  process.exitCode = ok ? 0 : 1;
}

function fmtFailures(failures: string[]): string {
  return failures.map((f) => `- ${f}`).join("\n");
}

function outDir(): string {
  return join(process.cwd(), "evals", "rag", "out");
}

function writeReport(results: RagEvalResult[]) {
  try {
    mkdirSync(outDir(), { recursive: true });
    const path = join(outDir(), `report.${Date.now()}.json`);
    writeFileSync(path, JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2), "utf-8");
    console.error(`Report saved: ${path}`);
  } catch {
    // best-effort
  }
}

function defaultCasesPath(): string {
  return join(process.cwd(), "evals", "rag", "cases", "core.jsonl");
}

function createOpenAiClientFromEnv(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY. Set it to run evals (prompt-only or full RAG).",
    );
  }
  return new OpenAI({ apiKey });
}

async function runPromptOnlyCase(client: OpenAI, c: RagEvalCase): Promise<RagEvalResult> {
  const chatModel = c.chat_model ?? process.env.OPENAI_CHAT_MODEL ?? "gpt-4.1-mini";
  const system = storeRagSystemPrompt("en");
  const context = c.retrieved_context ?? "NO_CONTEXT";
  const payload = buildStoreRagUserPayload(c.question, context, c.catalog_product_count);

  const completion = await client.chat.completions.create({
    model: chatModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: payload },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "(no content)";
  const { failures } = evaluateAssistantOutput({
    raw,
    checks: c.checks,
    // In prompt-only mode we don’t have a retrieval score; treat it as low when NO_CONFIDENT_CONTEXT is used.
    relevanceLabel: context.includes("NO_CONFIDENT_CONTEXT") ? "low" : undefined,
    retrievedContextForGrounding: context,
  });

  return {
    id: c.id,
    ok: failures.length === 0,
    mode: c.mode,
    question: c.question,
    failures,
    raw,
    answer_preview: raw.trim().slice(0, 220),
  };
}

async function runFullRagCase(client: OpenAI, c: RagEvalCase): Promise<RagEvalResult> {
  const embeddingModel =
    c.embedding_model ?? process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
  const chatModel = c.chat_model ?? process.env.OPENAI_CHAT_MODEL ?? "gpt-4.1-mini";

  const embedded = await getEmbeddedChunksSingleton(client, embeddingModel);
  const catalogCount = c.catalog_product_count ?? getCatalogProductCount();
  const res = await answerStoreQuestion(
    client,
    embedded,
    { question: c.question, catalogProductCount: catalogCount },
    { embeddingModel, chatModel },
  );

  // Rebuild a synthetic "raw" for reuse of the same parsing/assertion logic.
  // (We only stored `answer`; we can still enforce the presence of guidance by checking `res.guidance` too.)
  const raw = res.guidance
    ? `${res.answer}\n\n[[[GUIDANCE_JSON]]]\n${JSON.stringify(res.guidance)}`
    : res.answer;

  const ctxForGrounding = res.sources?.length
    ? res.sources
        .map((s) => embedded.find((e) => e.chunkId === s.chunkId)?.text)
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .join("\n\n")
    : "";

  const { failures } = evaluateAssistantOutput({
    raw,
    checks: c.checks,
    relevanceLabel: res.relevance.label,
    retrievedContextForGrounding: ctxForGrounding,
  });

  if (c.expect_relevance_at_least) {
    const order = { low: 0, medium: 1, high: 2 } as const;
    if (order[res.relevance.label] < order[c.expect_relevance_at_least]) {
      failures.push(
        `Relevance too low: expected at least ${c.expect_relevance_at_least}, got ${res.relevance.label} (bestScore=${res.relevance.bestScore.toFixed(3)}).`,
      );
    }
  }

  return {
    id: c.id,
    ok: failures.length === 0,
    mode: c.mode,
    question: c.question,
    failures,
    answer_preview: res.answer.trim().slice(0, 220),
    relevance: res.relevance,
    sources: res.sources,
  };
}

async function main() {
  const casesPath = process.argv[2]?.trim() || defaultCasesPath();
  const cases = readJsonl(casesPath);
  const filter = process.env.EVAL_FILTER?.trim().toLowerCase();
  const selected =
    filter && filter.length
      ? cases.filter(
          (c) =>
            c.id.toLowerCase().includes(filter) ||
            (c.tags ?? []).some((t) => t.toLowerCase().includes(filter)),
        )
      : cases;

  if (!selected.length) {
    console.error(`No eval cases selected (filter=${filter ?? "(none)"}).`);
    stableExit(true);
    return;
  }

  const client = createOpenAiClientFromEnv();

  const results: RagEvalResult[] = [];
  for (const c of selected) {
    try {
      if (c.mode === "prompt_only") results.push(await runPromptOnlyCase(client, c));
      else results.push(await runFullRagCase(client, c));
    } catch (e) {
      results.push({
        id: c.id,
        ok: false,
        mode: c.mode,
        question: c.question,
        failures: [e instanceof Error ? e.message : "Unknown error"],
        answer_preview: "",
      });
    }
  }

  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);

  console.error(`\nRAG evals: ${passed.length} passed, ${failed.length} failed (total ${results.length})`);
  for (const r of failed) {
    console.error(`\n[FAIL] ${r.id} (${r.mode})`);
    console.error(`Q: ${r.question}`);
    console.error(fmtFailures(r.failures));
    const fixes = suggestFixes(r.failures);
    if (fixes.length) {
      console.error("Suggested fixes:");
      for (const s of fixes.slice(0, 6)) console.error(`- ${s}`);
    }
    if (r.answer_preview) console.error(`Answer preview: ${r.answer_preview}`);
  }

  writeReport(results);
  stableExit(failed.length === 0);
}

await main();

