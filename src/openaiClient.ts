import OpenAI from "openai";
import "dotenv/config";

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY. Create tech-store-assistant/.env with OPENAI_API_KEY=... or export it in your shell.",
    );
  }

  return new OpenAI({ apiKey });
}

