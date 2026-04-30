import { NextResponse } from "next/server";
import { getOpenAIClient } from "../../../src/openaiClient";
import {
  answerStoreQuestion,
  buildStoreRagUserPayload,
  computeRelevance,
  parseGuidedAssistantOutput,
  storeRagSystemPrompt,
} from "../../../src/rag/answerStoreQuestion";
import { getCatalogProductCount } from "../../../src/rag/catalogMeta";
import { getEmbeddedChunksSingleton } from "../../../src/rag/indexSingleton";
import { embedTexts } from "../../../src/rag/embedChunks";
import { retrieveTopK } from "../../../src/rag/retrieve";
import { mockChatAnswer } from "./mockResponder";

export const runtime = "nodejs";

type ChatRole = "user" | "assistant" | "system";

type IncomingMessage = {
  role: ChatRole;
  content: string;
};

type IncomingBody = {
  messages?: IncomingMessage[];
  askSources?: boolean;
  topK?: number;
};

const MAX_MESSAGES = 20;
const MAX_USER_CHARS = 2000;

function shouldUseModeration(): boolean {
  const raw = process.env.RAG_USE_MODERATION?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function looksLikeInsult(text: string): boolean {
  // Lightweight local filter (best-effort). Use moderation for stronger coverage.
  const t = text.toLowerCase();
  const patterns: RegExp[] = [
    /\b(idiot|moron|stupid|dumb|asshole|bastard)\b/i,
    /\b(fuck\s*you|go\s*die|kill\s*yourself)\b/i,
    /\b(stronzo|coglione|idiota|stupido|cretino|vaffanculo)\b/i,
  ];
  return patterns.some((p) => p.test(t));
}

type RateState = { count: number; resetAtMs: number };
const rateGlobalKey = "__ragRateLimitState__";

function getRateMap(): Map<string, RateState> {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[rateGlobalKey]) g[rateGlobalKey] = new Map<string, RateState>();
  return g[rateGlobalKey] as Map<string, RateState>;
}

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function rateLimitOrThrow(key: string) {
  const limit = Number.parseInt(process.env.RAG_RATE_LIMIT_PER_MIN || "60", 10);
  const max = Number.isFinite(limit) && limit > 0 ? limit : 60;
  const now = Date.now();
  const map = getRateMap();
  const cur = map.get(key);
  if (!cur || cur.resetAtMs <= now) {
    map.set(key, { count: 1, resetAtMs: now + 60_000 });
    return;
  }
  cur.count += 1;
  if (cur.count > max) {
    const retryAfterSec = Math.ceil((cur.resetAtMs - now) / 1000);
    const err = new Error(`Rate limit exceeded. Retry in ~${retryAfterSec}s.`);
    (err as any).statusCode = 429;
    (err as any).retryAfterSec = retryAfterSec;
    throw err;
  }
}

function defaultMinScore(): number {
  const raw = process.env.RAG_MIN_SCORE;
  if (!raw) return 0.25;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0.25;
}

function buildContextBlock(hits: ReturnType<typeof retrieveTopK>): string {
  return hits
    .map(
      ({ chunk, score }, i) =>
        `--- passage ${i + 1} (chunkId=${chunk.chunkId}, productId=${chunk.productId}, score=${score.toFixed(4)}) ---\n${chunk.text}`,
    )
    .join("\n\n");
}

function buildRetrievalQuery(messages: IncomingMessage[]): string {
  const recent = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-8);
  const lines = recent.map((m) => `${m.role.toUpperCase()}: ${m.content}`);
  return lines.join("\n");
}

function isExactlyRepeatedLastUserQuestion(messages: IncomingMessage[], question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  let seenUser = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    seenUser += 1;
    if (seenUser === 1) continue; // last user message is `question` itself
    return (m.content ?? "").trim() === q;
  }
  return false;
}

function lastAssistantMessage(messages: IncomingMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "assistant" && typeof m.content === "string" && m.content.trim()) return m.content.trim();
  }
  return null;
}

export async function POST(req: Request) {
  try {
    rateLimitOrThrow(getClientIp(req));
    const body = (await req.json()) as IncomingBody;
    const messages = Array.isArray(body.messages) ? body.messages.slice(-MAX_MESSAGES) : [];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const question = lastUser?.content?.trim();

    if (!question) {
      return NextResponse.json(
        { error: "Missing user message" },
        { status: 400 },
      );
    }

    // Deterministic E2E mode: no OpenAI calls, stable outputs.
    // Enabled either by env (CI) or by an explicit request header (local dev server reuse).
    const mockOn =
      process.env.E2E_MOCK_CHAT?.trim() === "1" ||
      req.headers.get("x-e2e-mock-chat")?.trim() === "1";
    if (mockOn) {
      const wantsStream =
        req.headers.get("accept")?.includes("text/event-stream") === true;
      const mock = mockChatAnswer(question);
      if (!wantsStream) {
        return NextResponse.json({
          answer: mock.answer,
          guidance: mock.guidance,
          relevance: mock.relevance,
          sources: body.askSources ? mock.sources : undefined,
        });
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          const send = (obj: unknown) => {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
          };
          send({ type: "status", value: "started" });
          send({ type: "status", value: "ready" });
          // In mock mode we don't need token streaming; emit final immediately.
          send({
            type: "final",
            answer: mock.answer.split("[[[GUIDANCE_JSON]]]")[0]?.trim() ?? mock.answer,
            guidance: mock.guidance,
            relevance: mock.relevance,
            sources: body.askSources ? mock.sources : undefined,
          });
          controller.close();
        },
      });
      return new NextResponse(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const client = getOpenAIClient();
    const embeddingModel =
      process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

    // If the client asks for a streaming response, use SSE.
    const wantsStream =
      req.headers.get("accept")?.includes("text/event-stream") === true;
    const retrievalQuery = buildRetrievalQuery(messages);
    if (question.length > MAX_USER_CHARS) {
      return NextResponse.json(
        { error: `Message too long (max ${MAX_USER_CHARS} chars).` },
        { status: 400 },
      );
    }

    // Block insults/harassment early.
    if (looksLikeInsult(question)) {
      return NextResponse.json(
        {
          error:
            "Please avoid insults. Rephrase your message in a respectful way and I’ll help.",
        },
        { status: 400 },
      );
    }

    // Optional: OpenAI moderation for stronger coverage (harassment/hate/violence/etc.)
    if (shouldUseModeration()) {
      const mod = await client.moderations.create({ input: question });
      const r = mod.results?.[0];
      const flagged = Boolean(r?.flagged);
      const categories = (r as any)?.categories as Record<string, boolean> | undefined;
      const harassment =
        categories?.harassment === true ||
        categories?.["harassment/threatening"] === true ||
        categories?.hate === true ||
        categories?.["hate/threatening"] === true;

      if (flagged && harassment) {
        return NextResponse.json(
          {
            error:
              "I can’t help with harassing or hateful content. Please rephrase your question respectfully.",
          },
          { status: 400 },
        );
      }
    }

    if (!wantsStream) {
      // Only cache if the question is EXACTLY repeated.
      if (isExactlyRepeatedLastUserQuestion(messages, question)) {
        const cached = lastAssistantMessage(messages);
        if (cached) {
          return NextResponse.json({
            answer: cached,
            guidance: undefined,
            relevance: { label: "high", bestScore: -1, scoreGap: null, contextUsed: true, minScore: defaultMinScore() },
            sources: body.askSources ? [] : undefined,
          });
        }
      }

      const embeddedChunks = await getEmbeddedChunksSingleton(client, embeddingModel);
      const answer = await answerStoreQuestion(client, embeddedChunks, {
        question: retrievalQuery || question,
        locale: "en",
        topK: body.topK,
        catalogProductCount: getCatalogProductCount(),
      });

      return NextResponse.json({
        answer: answer.answer,
        guidance: answer.guidance,
        relevance: answer.relevance,
        sources: body.askSources ? answer.sources : undefined,
      });
    }

    const chatModel = process.env.OPENAI_CHAT_MODEL ?? "gpt-4.1-mini";
    const envTopK = Number.parseInt(process.env.RAG_TOP_K || "4", 10);
    const topK = body.topK ?? (Number.isFinite(envTopK) ? envTopK : 4);
    const minScore = defaultMinScore();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        const send = (obj: unknown) => {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };

        // Kick off async work without blocking start()
        void (async () => {
          send({ type: "status", value: "started" });
          // Only cache if the question is EXACTLY repeated.
          if (isExactlyRepeatedLastUserQuestion(messages, question)) {
            const cached = lastAssistantMessage(messages);
            if (cached) {
              send({
                type: "final",
                answer: cached,
                guidance: undefined,
                relevance: { label: "high", bestScore: -1, scoreGap: null, contextUsed: true, minScore },
                sources: body.askSources ? [] : undefined,
              });
              controller.close();
              return;
            }
          }

          // RAG warm-up: embeddings/index build may take time (especially on first run).
          send({
            type: "status",
            value: "indexing",
            embeddingModel,
          });
          const embeddedChunks = await getEmbeddedChunksSingleton(client, embeddingModel);
          send({
            type: "status",
            value: "ready",
            embeddedChunks: embeddedChunks.length,
          });

          const [qEmbed] = await embedTexts(client, [retrievalQuery || question], embeddingModel);
          if (!qEmbed) throw new Error("Failed to embed user question");

          const hits = retrieveTopK(qEmbed, embeddedChunks, topK);
          const bestScore = hits[0]?.score ?? -1;
          const hasConfidentContext = bestScore >= minScore;
          const relevance = computeRelevance({
            hits,
            minScore,
            contextUsed: hasConfidentContext,
          });
          if (!hasConfidentContext) {
            const answer =
              "I can help, but I don’t have enough catalog context to answer reliably yet.\n\n" +
              "Which exact product/model (or product ID) is this about, and what’s the main issue or what are you trying to compare?";
            const guidance = {
              intent: "unknown" as const,
              stage: "identify_device" as const,
              clarifying_questions: [
                "Which exact product/model (or product ID) is this about?",
                "What’s the main issue or what are you trying to compare?",
              ],
              next_suggested_questions: [
                "If you share the product name/ID, I can quote the exact specs and price from the catalog.",
              ],
            };
            send({
              type: "final",
              answer,
              guidance,
              relevance,
              sources: body.askSources ? [] : undefined,
            });
            controller.close();
            return;
          }

          const context = buildContextBlock(hits);

          const userContent = buildStoreRagUserPayload(
            retrievalQuery || question,
            context,
            getCatalogProductCount(),
          );

          const completionStream = await client.chat.completions.create({
            model: chatModel,
            stream: true,
            messages: [
              { role: "system", content: storeRagSystemPrompt("en") },
              { role: "user", content: userContent },
            ],
          });

          let raw = "";
          for await (const chunk of completionStream) {
            const delta = chunk.choices[0]?.delta?.content ?? "";
            if (!delta) continue;
            raw += delta;
            send({ type: "token", value: delta });
          }

          const parsed = parseGuidedAssistantOutput(raw);
          send({
            type: "final",
            answer: parsed.message,
            guidance: parsed.guidance,
            relevance,
            sources: body.askSources
              ? hits.map((h) => ({
                  productId: h.chunk.productId,
                  chunkId: h.chunk.chunkId,
                  score: h.score,
                }))
              : undefined,
          });
          controller.close();
        })().catch((err) => {
          send({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
          controller.close();
        });
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = (err as any)?.statusCode && Number.isFinite((err as any).statusCode)
      ? (err as any).statusCode
      : 500;
    const retryAfterSec = (err as any)?.retryAfterSec;
    const headers: Record<string, string> = {};
    if (status === 429 && typeof retryAfterSec === "number") {
      headers["Retry-After"] = String(retryAfterSec);
    }
    return NextResponse.json({ error: message }, { status, headers });
  }
}

