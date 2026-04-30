import type { RagGuidance } from "../../../src/rag/answerStoreQuestion";

type MockResponse = {
  answer: string;
  guidance: RagGuidance;
  relevance: {
    label: "high" | "medium" | "low";
    bestScore: number;
    scoreGap: number | null;
    contextUsed: boolean;
    minScore: number;
  };
  sources?: Array<{ productId: string; chunkId: string; score: number }>;
};

function guided(answer: string, guidance: RagGuidance): string {
  return `${answer}\n\n[[[GUIDANCE_JSON]]]\n${JSON.stringify(guidance)}`;
}

export function mockChatAnswer(question: string): MockResponse {
  const q = question.trim().toLowerCase();
  const relevance = { label: "high" as const, bestScore: 0.9, scoreGap: 0.1, contextUsed: true, minScore: 0.25 };

  if (q.includes("openai_api_key") || q.includes("api key")) {
    return {
      answer: guided(
        "I cannot provide the OPENAI_API_KEY.",
        {
          intent: "unknown",
          stage: "answer",
          clarifying_questions: [],
          next_suggested_questions: [],
        },
      ),
      guidance: {
        intent: "unknown",
        stage: "answer",
        clarifying_questions: [],
        next_suggested_questions: [],
      },
      relevance,
      sources: [],
    };
  }

  if (q.includes("price") && q.includes("aurora")) {
    return {
      answer: guided(
        "The price of Aurora Vision 55\" 4K QLED is 799 EUR.",
        {
          intent: "pre_purchase",
          stage: "answer",
          clarifying_questions: [],
          next_suggested_questions: ["Do you want the key specs or a comparison with similar TVs?"],
        },
      ),
      guidance: {
        intent: "pre_purchase",
        stage: "answer",
        clarifying_questions: [],
        next_suggested_questions: ["Do you want the key specs or a comparison with similar TVs?"],
      },
      relevance,
      sources: [{ productId: "tv-aurora-55", chunkId: "tv-aurora-55:overview", score: 0.9 }],
    };
  }

  if (q.includes("compatible") && q.includes("phone")) {
    return {
      answer: guided(
        "Which product are you referring to, and what is your phone model?",
        {
          intent: "pre_purchase",
          stage: "identify_device",
          clarifying_questions: ["Which product are you referring to?", "What is your phone model?"],
          next_suggested_questions: [],
        },
      ),
      guidance: {
        intent: "pre_purchase",
        stage: "identify_device",
        clarifying_questions: ["Which product are you referring to?", "What is your phone model?"],
        next_suggested_questions: [],
      },
      relevance: { ...relevance, label: "low", contextUsed: false, bestScore: -1 },
      sources: [],
    };
  }

  return {
    answer: guided(
      "Hi! I’m the store assistant. What product can I help you with?",
      {
        intent: "unknown",
        stage: "answer",
        clarifying_questions: [],
        next_suggested_questions: ["Ask about a product’s price, specs, or troubleshooting."],
      },
    ),
    guidance: {
      intent: "unknown",
      stage: "answer",
      clarifying_questions: [],
      next_suggested_questions: ["Ask about a product’s price, specs, or troubleshooting."],
    },
    relevance,
    sources: [],
  };
}

