import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import type { EmbeddedChunk } from "../src/domain/product.js";
import { answerStoreQuestion } from "../src/rag/answerStoreQuestion.js";
import { normalizeVector } from "../src/rag/similarity.js";

function emb(
  productId: string,
  chunkId: string,
  vector: number[],
): EmbeddedChunk {
  return {
    chunkId,
    productId,
    section: "overview",
    text: `Details for ${chunkId}`,
    embedding: normalizeVector(vector),
  };
}

function createFakeClient(): OpenAI {
  const embeddingsCreate = vi.fn(
    async ({ input }: { input: string | string[] }) => {
      const inputs = Array.isArray(input) ? input : [input];
      return {
        data: inputs.map((_, index) => ({
          index,
          embedding: [4, 0, 0],
        })),
      };
    },
  );
  const chatCreate = vi.fn(async () => ({
    choices: [{ message: { content: "Risposta di test dal catalogo." } }],
  }));
  return {
    embeddings: { create: embeddingsCreate },
    chat: { completions: { create: chatCreate } },
  } as unknown as OpenAI;
}

describe("answerStoreQuestion", () => {
  it("retrieves grounded context and returns model answer with sources", async () => {
    const client = createFakeClient();

    const embedded: EmbeddedChunk[] = [
      emb("prod-a", "prod-a:overview", [1, 0, 0]),
      emb("prod-b", "prod-b:overview", [0, 1, 0]),
    ];

    const result = await answerStoreQuestion(client, embedded, {
      question: "test query",
      topK: 1,
      locale: "it",
    });

    expect(result.answer).toBe("Risposta di test dal catalogo.");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.productId).toBe("prod-a");
    expect(result.sources[0]?.chunkId).toBe("prod-a:overview");
    expect(result.embeddingModel).toBeTruthy();
    expect(result.chatModel).toBeTruthy();

    expect(client.chat.completions.create).toHaveBeenCalledTimes(1);
    const messages = (
      client.chat.completions.create as ReturnType<typeof vi.fn>
    ).mock.calls[0][0].messages as { role: string; content: string }[];
    const userMsg = messages.find((m) => m.role === "user");
    expect(userMsg?.content).toContain("prod-a:overview");
    expect(userMsg?.content).toContain("Details for prod-a:overview");
  });

  it("does not call chat model when retrieval is low-confidence (returns deterministic clarifying question)", async () => {
    const oldMin = process.env.RAG_MIN_SCORE;
    process.env.RAG_MIN_SCORE = "1.1"; // cosine similarity max is 1.0, so this forces low-confidence
    const client = createFakeClient();

    const embedded: EmbeddedChunk[] = [
      emb("prod-a", "prod-a:overview", [1, 0, 0]),
      emb("prod-b", "prod-b:overview", [0, 1, 0]),
    ];

    const result = await answerStoreQuestion(client, embedded, {
      question: "test query",
      topK: 2,
      locale: "en",
    });

    expect(result.relevance.label).toBe("low");
    expect(result.sources).toHaveLength(0);
    expect(result.answer.toLowerCase()).toMatch(/which exact product|product\/model|product id/);
    expect(result.guidance?.stage).toBe("identify_device");

    expect(client.chat.completions.create).toHaveBeenCalledTimes(0);

    process.env.RAG_MIN_SCORE = oldMin;
  });
});
