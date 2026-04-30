## RAG evals (failure-case driven)

This folder is a lightweight harness to **find and track chatbot failures** in your store RAG system.

### What it does

- Runs a set of JSONL cases (one per line) against:
  - **`prompt_only`**: system prompt + synthetic `RETRIEVED_PRODUCT_CONTEXT` (fast way to test prompt injection + formatting rules)
  - **`rag_full`**: full retrieval + embeddings + chat completion using your local catalog (`data/catalog.generated.5000.json` by default)
- Applies automatic checks that catch common issues:
  - Missing or malformed `[[[GUIDANCE_JSON]]]`
  - Over-confident “answers” when retrieval is low confidence (should ask clarifying questions)
  - Heuristic prompt-injection obedience signals

### Run

Set `OPENAI_API_KEY`, then:

```bash
npm run eval:rag
```

Optional:

```bash
# run a specific case (substring match on id or tag)
EVAL_FILTER=injection npm run eval:rag

# point to a different JSONL suite
npm run eval:rag -- evals/rag/cases/core.jsonl
```

### Add new failure cases

Add a new line to `evals/rag/cases/*.jsonl`:

```json
{"id":"my-case","mode":"prompt_only","question":"...","retrieved_context":"...","checks":{"must_have_guidance_json":true}}
```

