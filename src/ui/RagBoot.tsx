"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SuggestionNode } from "../../app/page";
import ChatUI from "./ChatUI";

type Phase =
  | "idle"
  | "checking_catalog_api"
  | "warming_rag"
  | "ready"
  | "error";

async function sleep(ms: number) {
  await new Promise<void>((r) => setTimeout(r, ms));
}

async function waitForCatalogApi(signal: AbortSignal): Promise<void> {
  // Poll Next BFF (which proxies to catalog-api) until it responds.
  // We use categories because it's small and fast.
  let attempt = 0;
  while (true) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    attempt += 1;
    try {
      const res = await fetch("/api/catalog/v1/categories", { signal, cache: "no-store" });
      if (res.ok) return;
    } catch {
      // ignore and retry
    }
    const backoff = Math.min(1500, 150 + attempt * 120);
    await sleep(backoff);
  }
}

async function warmupRag(signal: AbortSignal): Promise<{ embeddedChunks?: number; elapsedMs?: number }> {
  const res = await fetch("/api/rag/warmup", { signal, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Warmup failed (HTTP ${res.status})`);
  }
  return { embeddedChunks: data.embeddedChunks, elapsedMs: data.elapsedMs };
}

export default function RagBoot({
  suggestionTree,
  e2eMode = false,
}: {
  suggestionTree: SuggestionNode;
  e2eMode?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState<string>("");
  const ranRef = useRef(false);

  const canInteract = phase === "ready";

  const title = useMemo(() => {
    if (phase === "checking_catalog_api") return "Starting catalog API…";
    if (phase === "warming_rag") return "Warming up RAG…";
    if (phase === "error") return "Startup error";
    return "Starting…";
  }, [phase]);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const ac = new AbortController();

    void (async () => {
      try {
        if (e2eMode) {
          // Deterministic E2E: do not block on external services.
          setPhase("ready");
          setDetail("Ready.");
          return;
        }

        setPhase("checking_catalog_api");
        setDetail("Waiting for /api/catalog/v1/* to respond…");
        await waitForCatalogApi(ac.signal);

        const skipWarmup = (process.env.NEXT_PUBLIC_E2E_SKIP_WARMUP || "").trim() === "1";
        if (!skipWarmup) {
          setPhase("warming_rag");
          setDetail("Indexing embeddings (first time may take a while)…");
        }
        const warm = skipWarmup ? {} : await warmupRag(ac.signal);
        if (typeof warm.embeddedChunks === "number") {
          setDetail(`Ready (${warm.embeddedChunks.toLocaleString()} embedded chunks).`);
        } else {
          setDetail("Ready.");
        }
        setPhase("ready");
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setPhase("error");
        setDetail(e instanceof Error ? e.message : "Unknown error");
      }
    })();

    return () => ac.abort();
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <ChatUI suggestionTree={suggestionTree} e2eMode={e2eMode} />

      {!canInteract ? (
        <div className="app-bootOverlay" role="status" aria-live="polite">
          <div className="app-bootCard">
            <div className="app-bootTitle">{title}</div>
            <div className="app-bootBody">{detail}</div>
            <div className="app-bootSpinner" aria-hidden />
            {phase === "error" ? (
              <div className="app-bootHint">
                Check that `OPENAI_API_KEY` is set and that `npm run dev:catalog-api` is running (or that `CATALOG_API_BASE_URL` points to a reachable service).
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

