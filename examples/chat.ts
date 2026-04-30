import { getOpenAIClient } from "../src/openaiClient.js";

const client = getOpenAIClient();

// Chat Completions (classic interface)
const result = await client.chat.completions.create({
  model: "gpt-4.1-mini",
  messages: [
    { role: "system", content: "You are a concise assistant." },
    { role: "user", content: "Give me 3 bullet points on what the OpenAI API does." },
  ],
});

console.log(result.choices[0]?.message?.content ?? "(no content)");

