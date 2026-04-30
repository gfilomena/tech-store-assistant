import { describe, expect, it, vi } from "vitest";

// Mock the OpenAI SDK so tests don't hit the network.
vi.mock("openai", () => {
  class OpenAI {
    apiKey: string;
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
    }
  }
  return { default: OpenAI };
});

describe("getOpenAIClient", () => {
  it("throws if OPENAI_API_KEY is missing", async () => {
    const old = process.env.OPENAI_API_KEY;
    const mod = await import("../src/openaiClient.js");
    // Import runs dotenv/config, which may repopulate OPENAI_API_KEY from .env.
    delete process.env.OPENAI_API_KEY;
    expect(() => mod.getOpenAIClient()).toThrow(/OPENAI_API_KEY/);

    process.env.OPENAI_API_KEY = old;
  });

  it("creates an OpenAI client when OPENAI_API_KEY is present", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    const mod = await import("../src/openaiClient.js");
    const client = mod.getOpenAIClient() as { apiKey?: string };

    expect(client).toBeTruthy();
    expect(client.apiKey).toBe("test-key");
  });
});

