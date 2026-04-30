import { readFileSync } from "node:fs";
import { join } from "node:path";
import RagBoot from "../src/ui/RagBoot";

type ScenarioFile = {
  scenarios: Array<{
    id: string;
    phase: "pre_purchase" | "post_purchase";
    category: string;
    title: string;
    user_utterances: string[];
  }>;
};

export type SuggestionNode = {
  id: string;
  label: string;
  children?: SuggestionNode[];
  // If set, clicking this node sends this text as a user message.
  sendText?: string;
};

function toTitleCase(s: string): string {
  if (!s) return s;
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

function loadSuggestionTree(): SuggestionNode {
  const p = join(process.cwd(), "data", "support-scenarios.json");
  const raw = readFileSync(p, "utf-8");
  const parsed = JSON.parse(raw) as ScenarioFile;

  const pre = parsed.scenarios.filter((s) => s.phase === "pre_purchase");
  const post = parsed.scenarios.filter((s) => s.phase === "post_purchase");

  function groupByCategory(items: typeof pre): SuggestionNode[] {
    const map = new Map<string, typeof items>();
    for (const s of items) {
      const k = s.category || "general";
      const arr = map.get(k) ?? [];
      arr.push(s);
      map.set(k, arr);
    }

    const categories = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    return categories.map(([cat, scenarios]) => ({
      id: `cat:${cat}`,
      label: cat === "general" ? "General" : toTitleCase(cat),
      children: scenarios
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((s) => ({
          id: `scenario:${s.id}`,
          label: s.title,
          children: s.user_utterances.slice(0, 3).map((u, idx) => ({
            id: `utterance:${s.id}:${idx}`,
            label: u,
            sendText: u,
          })),
        })),
    }));
  }

  return {
    id: "root",
    label: "Start",
    children: [
      {
        id: "need-info",
        label: "I need product information",
        children: groupByCategory(pre),
      },
      {
        id: "have-problem",
        label: "I have a problem with a product",
        children: groupByCategory(post),
      },
    ],
  };
}

export default function Page({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const suggestionTree = loadSuggestionTree();
  const e2eMode = searchParams?.e2e === "1";

  return (
    <main className="chat-page">
      <div className="chat-shell">
        <div className="chat-shell__inner">
          <header className="chat-shell__header">
            <div>
              <div className="chat-shell__title">Tech Store Assistant</div>
              <div className="chat-shell__subtitle">
                Pre‑purchase product info + basic post‑purchase support (grounded in your catalog/KB)
              </div>
            </div>
          </header>

          <RagBoot suggestionTree={suggestionTree} e2eMode={e2eMode} />
        </div>
      </div>
    </main>
  );
}

