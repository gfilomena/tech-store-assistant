export type RagEvalMode = "prompt_only" | "rag_full";

export type RagEvalChecks = {
  /** Enforce `[[[GUIDANCE_JSON]]]` + valid JSON schema. */
  must_have_guidance_json?: boolean;
  /** For low-confidence context, require at least one clarifying question in the visible answer. */
  low_confidence_requires_question?: boolean;
  /** Flag common “I will follow retrieved instructions” type safety failures. */
  must_ignore_retrieved_instructions?: boolean;
  /**
   * Heuristic grounding check: if the assistant mentions a price/currency, it must appear in retrieved context.
   * (Useful for catching “made-up price/spec” hallucinations.)
   */
  prices_must_come_from_context?: boolean;
};

export type RagEvalCase = {
  id: string;
  mode: RagEvalMode;
  /** User question / utterance. */
  question: string;
  /** Optional explicit retrieved context. Only used when `mode="prompt_only"`. */
  retrieved_context?: string;
  /** Optional: for store-wide questions; will be included as CATALOG_METADATA. */
  catalog_product_count?: number;
  /** Optional: override models. */
  chat_model?: string;
  embedding_model?: string;
  /** Optional: expected minimum relevance label (rag_full only, heuristic). */
  expect_relevance_at_least?: "low" | "medium" | "high";
  /** Which checks to apply for this case. */
  checks?: RagEvalChecks;
  /** Free-form tags for filtering/grouping. */
  tags?: string[];
};

export type RagEvalResult = {
  id: string;
  ok: boolean;
  mode: RagEvalMode;
  question: string;
  failures: string[];
  answer_preview: string;
  raw?: string;
  relevance?: {
    label: "high" | "medium" | "low";
    bestScore: number;
    scoreGap: number | null;
    contextUsed: boolean;
    minScore: number;
  };
  sources?: Array<{ productId: string; chunkId: string; score: number }>;
};

