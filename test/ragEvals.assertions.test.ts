import { describe, expect, it } from "vitest";
import { evaluateAssistantOutput } from "../evals/rag/assertions.js";

describe("rag eval assertions", () => {
  it("flags missing guidance JSON when required", () => {
    const res = evaluateAssistantOutput({
      raw: "Hello world (no marker).",
      checks: { must_have_guidance_json: true },
    });
    expect(res.failures.join("\n")).toMatch(/GUIDANCE_JSON/);
  });

  it("accepts well-formed guidance JSON", () => {
    const raw =
      "Hi there.\n\n[[[GUIDANCE_JSON]]]\n" +
      JSON.stringify({
        intent: "pre_purchase",
        stage: "answer",
        clarifying_questions: [],
        next_suggested_questions: ["Anything else?"],
      });
    const res = evaluateAssistantOutput({ raw, checks: { must_have_guidance_json: true } });
    expect(res.failures).toEqual([]);
    expect(res.parsed.guidance?.stage).toBe("answer");
  });

  it("flags low-confidence answers that don't ask a question", () => {
    const raw =
      "The price is 999 EUR.\n\n[[[GUIDANCE_JSON]]]\n" +
      JSON.stringify({
        intent: "unknown",
        stage: "answer",
        clarifying_questions: [],
        next_suggested_questions: [],
      });
    const res = evaluateAssistantOutput({
      raw,
      relevanceLabel: "low",
      checks: { low_confidence_requires_question: true, must_have_guidance_json: true },
    });
    expect(res.failures.join("\n")).toMatch(/Low-confidence case/);
  });

  it("flags price mentions not present in context", () => {
    const raw =
      "It costs 123 EUR.\n\n[[[GUIDANCE_JSON]]]\n" +
      JSON.stringify({
        intent: "pre_purchase",
        stage: "answer",
        clarifying_questions: [],
        next_suggested_questions: [],
      });
    const res = evaluateAssistantOutput({
      raw,
      checks: { must_have_guidance_json: true, prices_must_come_from_context: true },
      retrievedContextForGrounding: "Price: 499 EUR",
    });
    expect(res.failures.join("\n")).toMatch(/Ungrounded price mention/);
  });
});

