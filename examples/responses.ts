import { getOpenAIClient } from "../src/openaiClient.js";

const client = getOpenAIClient();

// Responses API (recommended newer interface)
const response = await client.responses.create({
  model: "gpt-4.1-mini",
  input: [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: "Explain, with a tiny TypeScript snippet, how to call the OpenAI API.",
        },
      ],
    },
  ],
});

console.log(response.output_text);

