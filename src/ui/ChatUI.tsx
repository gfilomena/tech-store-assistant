"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** Narrow Web Speech types (DOM globals are not always visible when `types` is `["node"]` only). */
type WebSpeechRecognitionResultList = {
  readonly length: number;
  readonly [index: number]: {
    readonly isFinal: boolean;
    readonly 0: { readonly transcript: string };
  };
};

type WebSpeechRecognitionEvent = {
  readonly results: WebSpeechRecognitionResultList;
};

type WebSpeechRecognitionErrorEvent = {
  readonly error: string;
};

type WebSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((ev: WebSpeechRecognitionEvent) => void) | null;
  onerror: ((ev: WebSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognitionConstructor(): (new () => WebSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => WebSpeechRecognition;
    webkitSpeechRecognition?: new () => WebSpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function pickMediaRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

function canUseOpenAiRecording(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(pickMediaRecorderMime())
  );
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path
        d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.25 : 0}
      />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v4" />
      <path d="M8 23h8" />
    </svg>
  );
}

type SuggestionNode = {
  id: string;
  label: string;
  children?: SuggestionNode[];
  sendText?: string;
};

type ChatRole = "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
  chips?: string[];
  relevance?: {
    label: "high" | "medium" | "low";
    bestScore: number;
    scoreGap: number | null;
    contextUsed: boolean;
    minScore: number;
  };
};

type ChatResponse = {
  answer: string;
  guidance?: {
    intent: "pre_purchase" | "post_purchase" | "unknown";
    stage: "identify_device" | "clarify_problem" | "answer";
    clarifying_questions: string[];
    next_suggested_questions: string[];
  };
  relevance?: ChatMessage["relevance"];
  sources?: Array<{ productId: string; chunkId: string; score: number }>;
};

export default function ChatUI({
  suggestionTree,
  e2eMode = false,
}: {
  suggestionTree: SuggestionNode;
  e2eMode?: boolean;
}) {
  const initialMessages: ChatMessage[] = [
    {
      role: "assistant",
      content:
        "Hi! I’m the store assistant. Ask me about tech products (TVs, smartphones, laptops, audio, wearables).",
    },
  ];
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [showSources, setShowSources] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechListening, setSpeechListening] = useState(false);
  const [speechHint, setSpeechHint] = useState<string | null>(null);
  const [offerOpenAiVoice, setOfferOpenAiVoice] = useState(false);
  const [openAiVoicePhase, setOpenAiVoicePhase] = useState<"idle" | "recording" | "uploading">("idle");
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [serverStatus, setServerStatus] = useState<string | null>(null);
  const lastQRef = useRef<string>("");
  const lastARef = useRef<string>("");

  const listRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const speechRecognitionRef = useRef<WebSpeechRecognition | null>(null);
  const speechPrefixRef = useRef("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const [suggestionPath, setSuggestionPath] = useState<string[]>([]);

  const currentSuggestionNode = useMemo(() => {
    let node: SuggestionNode | undefined = suggestionTree;
    for (const id of suggestionPath) {
      node = node?.children?.find((c) => c.id === id);
      if (!node) break;
    }
    return node ?? suggestionTree;
  }, [suggestionPath, suggestionTree]);

  const showGuidedStarter = messages.length <= 1;

  useEffect(() => {
    setSpeechSupported(!!getSpeechRecognitionConstructor());
  }, []);

  useEffect(() => {
    return () => {
      speechRecognitionRef.current?.abort();
      speechRecognitionRef.current = null;
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    };
  }, []);

  function stopSpeechListening() {
    try {
      speechRecognitionRef.current?.stop();
    } catch {
      speechRecognitionRef.current?.abort();
    }
    speechRecognitionRef.current = null;
    setSpeechListening(false);
  }

  function startSpeechListening() {
    setSpeechHint(null);
    setOfferOpenAiVoice(false);
    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor || busy) return;

    speechPrefixRef.current = input.trimEnd();
    const recognition = new Ctor();
    speechRecognitionRef.current = recognition;
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setSpeechListening(true);

    recognition.onresult = (event: WebSpeechRecognitionEvent) => {
      let spoken = "";
      for (let i = 0; i < event.results.length; i++) {
        spoken += event.results[i]![0]!.transcript;
      }
      spoken = spoken.trim();
      const prefix = speechPrefixRef.current;
      const combined = [prefix, spoken].filter(Boolean).join(" ").trim();
      setInput(combined);
    };

    recognition.onerror = (event: WebSpeechRecognitionErrorEvent) => {
      if (event.error === "aborted") return;
      const friendly =
        event.error === "not-allowed"
          ? "Microphone permission denied. Allow the mic for this site in your browser settings."
          : event.error === "network"
            ? "The browser’s speech service couldn’t be reached (often blocked by network, VPN, or filters). Type your question below, or use “Record with OpenAI” to transcribe on our server."
            : event.error === "service-not-allowed"
              ? "The browser blocked the speech service. Type below, or use “Record with OpenAI” if available."
            : event.error === "no-speech"
              ? "No speech detected. Try again or speak closer to the microphone."
              : event.error === "audio-capture"
                ? "No microphone found. Check that a mic is connected."
                : `Voice input error: ${event.error}`;
      setSpeechHint(friendly);
      setSpeechListening(false);
      speechRecognitionRef.current = null;
      setOfferOpenAiVoice(
        (event.error === "network" || event.error === "service-not-allowed") &&
          canUseOpenAiRecording(),
      );
    };

    recognition.onend = () => {
      setSpeechListening(false);
      speechRecognitionRef.current = null;
    };

    try {
      recognition.start();
    } catch {
      setSpeechHint("Could not start voice input. Try again.");
      setSpeechListening(false);
      speechRecognitionRef.current = null;
    }
  }

  function toggleSpeechListening() {
    if (speechListening) {
      stopSpeechListening();
      return;
    }
    startSpeechListening();
  }

  function stopOpenAiMedia() {
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      /* ignore */
    }
    mediaRecorderRef.current = null;
    mediaChunksRef.current = [];
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    setOpenAiVoicePhase("idle");
  }

  async function startOpenAiRecording() {
    if (busy || openAiVoicePhase === "uploading") return;
    const mime = pickMediaRecorderMime();
    if (!mime) {
      setSpeechHint("Voice recording format not supported in this browser.");
      return;
    }
    stopOpenAiMedia();
    setSpeechHint(null);
    speechPrefixRef.current = input.trimEnd();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      mediaChunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) mediaChunksRef.current.push(e.data);
      };
      mr.start(400);
      setOpenAiVoicePhase("recording");
    } catch {
      setSpeechHint("Microphone permission denied or unavailable.");
      stopOpenAiMedia();
    }
  }

  async function stopOpenAiRecordingAndTranscribe() {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === "inactive") {
      stopOpenAiMedia();
      return;
    }
    setOpenAiVoicePhase("uploading");
    const mimeType = mr.mimeType;
    await new Promise<void>((resolve) => {
      mr.addEventListener("stop", () => resolve(), { once: true });
      mr.stop();
    });
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    const blob = new Blob(mediaChunksRef.current, { type: mimeType });
    mediaChunksRef.current = [];
    if (blob.size < 600) {
      setSpeechHint("Recording too short. Try again with a full sentence.");
      setOfferOpenAiVoice(true);
      setOpenAiVoicePhase("idle");
      return;
    }
    try {
      const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("mp4") ? "m4a" : "bin";
      const fd = new FormData();
      fd.append("audio", blob, `speech.${ext}`);
      const res = await fetch("/api/speech/transcribe", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const text = (data.text ?? "").trim();
      const prefix = speechPrefixRef.current;
      const combined = [prefix, text].filter(Boolean).join(" ").trim();
      setInput(combined);
      setSpeechHint(null);
      setOfferOpenAiVoice(false);
    } catch (e) {
      setSpeechHint(e instanceof Error ? e.message : "Transcription failed");
      setOfferOpenAiVoice(true);
    } finally {
      setOpenAiVoicePhase("idle");
    }
  }

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }

  useEffect(() => {
    // If the user scrolls up, don't keep snapping them back to the bottom.
    const el = listRef.current;
    if (!el) return;

    const onScroll = () => {
      const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
      setPinnedToBottom(distance < 48);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!pinnedToBottom) return;
    const id = requestAnimationFrame(() => scrollToBottom("smooth"));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, busy, error, pinnedToBottom]);

  const followUpChips = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === "assistant" && m.chips?.length) return m.chips;
    }
    return [];
  }, [messages]);

  useEffect(() => {
    // #region agent log
    try {
      const el = listRef.current;
      const firstBody = el?.querySelector?.(".tech-chat__msgBody") as HTMLElement | null;
      const followups = document.querySelector?.(".tech-chat__followups") as HTMLElement | null;
      const scheme =
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
      const bodyStyle = firstBody ? window.getComputedStyle(firstBody) : null;
      const msg = firstBody?.closest?.(".tech-chat__msg") as HTMLElement | null;
      const msgStyle = msg ? window.getComputedStyle(msg) : null;
      const followupsStyle = followups ? window.getComputedStyle(followups) : null;
      const scrollStyle = el ? window.getComputedStyle(el) : null;
      const msgRect = msg ? msg.getBoundingClientRect() : null;

      fetch("/api/debug/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: "pre-fix",
          hypothesisId: "H_css_invisible_text",
          location: "src/ui/ChatUI.tsx:382",
          message: "Computed styles snapshot",
          data: {
            prefersColorScheme: scheme,
            messagesCount: messages.length,
            followUpChipsCount: followUpChips.length,
            scrollClientHeight: el?.clientHeight,
            scrollScrollHeight: el?.scrollHeight,
            scrollCanScroll: typeof el?.scrollHeight === "number" && typeof el?.clientHeight === "number" ? el.scrollHeight > el.clientHeight + 1 : null,
            scrollOverflowY: scrollStyle?.overflowY,
            firstMsgBodyColor: bodyStyle?.color,
            firstMsgBodyOpacity: bodyStyle?.opacity,
            firstMsgBodyVisibility: bodyStyle?.visibility,
            firstMsgBodyDisplay: bodyStyle?.display,
            firstMsgBodyFilter: bodyStyle?.filter,
            firstMsgBg: msgStyle?.backgroundColor,
            firstMsgBorder: msgStyle?.borderTopColor,
            firstMsgRectHeight: msgRect?.height,
            followupsBg: followupsStyle?.backgroundColor,
            followupsColor: followupsStyle?.color,
            followupsOpacity: followupsStyle?.opacity,
            followupsVisibility: followupsStyle?.visibility,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    } catch {
      // ignore
    }
    // #endregion
  }, [messages.length, followUpChips.length]);

  function resetChat() {
    stopSpeechListening();
    stopOpenAiMedia();
    setOfferOpenAiVoice(false);
    setSpeechHint(null);
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setError(null);
    setInput("");
    setSuggestionPath([]);
    setMessages(initialMessages);
    queueMicrotask(() => {
      const el = listRef.current;
      if (!el) return;
      el.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;

    // If the user repeats the exact same question, reuse the previous answer immediately.
    // This avoids redundant API calls and matches typical chatbot behavior.
    if (lastQRef.current && lastARef.current && q === lastQRef.current) {
      const nextMessages: ChatMessage[] = [
        ...messages,
        { role: "user", content: q },
        { role: "assistant", content: lastARef.current },
      ];
      setMessages(nextMessages);
      queueMicrotask(() => scrollToBottom("smooth"));
      return;
    }

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    stopSpeechListening();
    stopOpenAiMedia();
    setOfferOpenAiVoice(false);
    setSpeechHint(null);
    setError(null);
    setBusy(true);
    setInput("");

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: q }];
    // Add an empty assistant message we will fill (streaming or non-streaming).
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    queueMicrotask(() => scrollToBottom("auto"));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(e2eMode ? { "x-e2e-mock-chat": "1" } : {}),
        },
        signal: abort.signal,
        body: JSON.stringify({
          messages: nextMessages,
          askSources: showSources,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(body || `HTTP ${res.status}`);
      }

      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("text/event-stream")) {
        // Fallback to JSON response if the server didn't stream.
        const data = (await res.json()) as ChatResponse;
        const suffix =
          showSources && data.sources?.length
            ? `\n\nSources:\n${data.sources
                .map(
                  (s) =>
                    `- ${s.productId} / ${s.chunkId} (score=${s.score.toFixed(3)})`,
                )
                .join("\n")}`
            : "";

        const chips = [
          ...(data.guidance?.clarifying_questions ?? []),
          ...(data.guidance?.next_suggested_questions ?? []),
        ].filter((x) => typeof x === "string" && x.trim().length > 0);

        setMessages((m) => {
          const out = m.slice();
          out[out.length - 1] = {
            role: "assistant",
            content: data.answer + suffix,
            chips: chips.slice(0, 3),
            relevance: data.relevance,
          };
          return out;
        });
        queueMicrotask(() => scrollToBottom("smooth"));
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Streaming response has no body");

      const dec = new TextDecoder();
      let sseBuffer = "";
      let raw = "";
      const marker = "[[[GUIDANCE_JSON]]]";
      let showedMarker = false;
      setServerStatus("started");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += dec.decode(value, { stream: true });

        // Process complete SSE events separated by a blank line.
        while (true) {
          const sep = sseBuffer.indexOf("\n\n");
          if (sep === -1) break;
          const event = sseBuffer.slice(0, sep);
          sseBuffer = sseBuffer.slice(sep + 2);

          const line = event
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l.startsWith("data:"));
          if (!line) continue;

          const json = line.replace(/^data:\s*/, "");
          const payload = JSON.parse(json) as any;

          if (payload.type === "status" && typeof payload.value === "string") {
            setServerStatus(payload.value);
          }

          if (payload.type === "token" && typeof payload.value === "string") {
            raw += payload.value;
            if (!showedMarker) {
              const idx = raw.indexOf(marker);
              const visible = idx === -1 ? raw : raw.slice(0, idx);
              if (idx !== -1) showedMarker = true;
              setMessages((m) => {
                const out = m.slice();
                out[out.length - 1] = { ...(out[out.length - 1] ?? { role: "assistant", content: "" }), role: "assistant", content: visible };
                return out;
              });
            }
          }

          if (payload.type === "final") {
            const data = payload as ChatResponse;
            const suffix =
              showSources && data.sources?.length
                ? `\n\nSources:\n${data.sources
                    .map(
                      (s) =>
                        `- ${s.productId} / ${s.chunkId} (score=${s.score.toFixed(3)})`,
                    )
                    .join("\n")}`
                : "";

            const chips = [
              ...(data.guidance?.clarifying_questions ?? []),
              ...(data.guidance?.next_suggested_questions ?? []),
            ].filter((x) => typeof x === "string" && x.trim().length > 0);

            setMessages((m) => {
              const out = m.slice();
              out[out.length - 1] = {
                role: "assistant",
                content: (data.answer ?? "").trim() + suffix,
                chips: chips.slice(0, 3),
                relevance: data.relevance,
              };
              return out;
            });
            queueMicrotask(() => scrollToBottom("smooth"));
            setServerStatus(null);

            lastQRef.current = q;
            lastARef.current = ((data.answer ?? "").trim() + suffix).trim();
          }

          if (payload.type === "error") {
            throw new Error(payload.message || "Stream error");
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // User started a new chat or sent another message.
        return;
      }
      setError(e instanceof Error ? e.message : "Unknown error");
      // Remove empty assistant placeholder if present.
      setMessages((m) => (m[m.length - 1]?.role === "assistant" && !m[m.length - 1]?.content ? m.slice(0, -1) : m));
    } finally {
      setBusy(false);
      setServerStatus(null);
      if (abortRef.current === abort) abortRef.current = null;
    }
  }

  return (
    <div className="tech-chat">
      <div className="tech-chat__toolbar">
        <button
          type="button"
          onClick={resetChat}
          disabled={busy && messages.length <= 1}
          className="tech-chat__btnGhost"
          title="Start a new chat from scratch"
        >
          New chat
        </button>

        <div className="tech-chat__toolbarHint">
          {messages.length > 1 ? "Conversation in progress" : "Start a conversation"}
        </div>
      </div>

      <div ref={listRef} className="tech-chat__scroll">
        {showGuidedStarter && currentSuggestionNode.children?.length ? (
          <div className="tech-chat__starter">
            <div className="tech-chat__starterLabel">Quick start (choose a path)</div>
            <div className="tech-chat__pathRow">
              <div className="tech-chat__pathText">
                Path:{" "}
                {suggestionPath.length
                  ? suggestionPath
                      .map((id) => {
                        // Best-effort label lookup from the tree.
                        let node: SuggestionNode | undefined = suggestionTree;
                        let label = suggestionTree.label;
                        for (const step of suggestionPath) {
                          node = node?.children?.find((c) => c.id === step);
                          if (!node) break;
                          label = node.label;
                          if (step === id) break;
                        }
                        return label;
                      })
                      .join(" › ")
                  : "Start"}
              </div>
              {suggestionPath.length ? (
                <button
                  type="button"
                  onClick={() => setSuggestionPath((p) => p.slice(0, -1))}
                  disabled={busy}
                  className="tech-chat__btnGhost"
                >
                  Back
                </button>
              ) : null}
            </div>

            <div className="tech-chat__pillRow">
              {currentSuggestionNode.children.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => {
                    if (child.sendText) {
                      void send(child.sendText);
                      return;
                    }
                    if (child.children?.length) {
                      setSuggestionPath((p) => [...p, child.id]);
                      return;
                    }
                    void send(child.label);
                  }}
                  disabled={busy}
                  className="tech-chat__pill"
                  title={child.label}
                >
                  {child.label.length > 64 ? child.label.slice(0, 64) + "…" : child.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`tech-chat__msg ${
              m.role === "user" ? "tech-chat__msg--user" : "tech-chat__msg--assistant"
            }`}
          >
            <div className="tech-chat__msgRole">{m.role === "user" ? "You" : "Assistant"}</div>
            <div className="tech-chat__msgBody">{m.content}</div>

            {m.role === "assistant" && m.relevance ? (
              <div className="tech-chat__relevanceRow">
                Confidence:{" "}
                <span
                  className={
                    m.relevance.label === "high"
                      ? "tech-chat__relevanceHigh"
                      : m.relevance.label === "medium"
                        ? "tech-chat__relevanceMed"
                        : "tech-chat__relevanceLow"
                  }
                >
                  {m.relevance.label.toUpperCase()}
                </span>{" "}
                · bestScore={m.relevance.bestScore.toFixed(3)}
                {m.relevance.scoreGap === null ? "" : ` · gap=${m.relevance.scoreGap.toFixed(3)}`}
                {m.relevance.contextUsed ? "" : " · no confident context"}
              </div>
            ) : null}
          </div>
        ))}

        {busy ? (
          <div className="tech-chat__thinking" aria-label="Assistant is thinking">
            <div className="tech-chat__msgRole">Assistant</div>
            <div className="tech-chat__msgBody" style={{ color: "rgba(186, 198, 230, 0.75)" }}>
              <span className="typingDots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        ) : null}

        {error ? <div className="tech-chat__error">Error: {error}</div> : null}
      </div>

      <div className="tech-chat__composer">
        {serverStatus === "indexing" ? (
          <div className="tech-chat__followups" aria-live="polite">
            <div className="tech-chat__followupsTitle">Warming up</div>
            <div className="tech-chat__status" style={{ marginTop: 10 }}>
              Indexing catalog embeddings… first response may be slow.
            </div>
          </div>
        ) : null}

        {followUpChips.length ? (
          <div className="tech-chat__followups" role="group" aria-label="Suggested next questions">
            <div className="tech-chat__followupsTitle">Suggested next questions</div>
            <div className="tech-chat__chipsRow" style={{ marginTop: 10 }}>
              {followUpChips.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => send(c)}
                  disabled={busy}
                  className="tech-chat__chip"
                  title={c}
                >
                  {c.length > 72 ? c.slice(0, 72) + "…" : c}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="tech-chat__composerRow">
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label className="tech-chat__label">
              <input
                type="checkbox"
                checked={showSources}
                onChange={(e) => setShowSources(e.target.checked)}
                disabled={busy}
              />
              <span>Show sources</span>
            </label>
          </div>

          <div className="tech-chat__status">{busy ? "Thinking" : "Ready"}</div>
        </div>

        {speechHint || offerOpenAiVoice || openAiVoicePhase !== "idle" ? (
          <div className="tech-chat__speechPanel">
            {speechHint ? <div>{speechHint}</div> : null}
            {openAiVoicePhase === "uploading" ? (
              <div className="tech-chat__status">Transcribing with OpenAI…</div>
            ) : openAiVoicePhase === "recording" ? (
              <div className="tech-chat__pillRow">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void stopOpenAiRecordingAndTranscribe()}
                  className="tech-chat__btnGhost"
                  style={{ background: "rgba(0, 212, 255, 0.2)", borderColor: "rgba(0, 212, 255, 0.45)" }}
                >
                  Stop & transcribe
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    stopOpenAiMedia();
                    setSpeechHint(null);
                    setOfferOpenAiVoice(false);
                  }}
                  className="tech-chat__btnGhost"
                >
                  Cancel
                </button>
              </div>
            ) : offerOpenAiVoice ? (
              <div className="tech-chat__pathRow" style={{ marginBottom: 0 }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startOpenAiRecording()}
                  className="tech-chat__btnGhost"
                  style={{ background: "rgba(124, 92, 255, 0.22)", borderColor: "rgba(124, 92, 255, 0.45)" }}
                >
                  Record with OpenAI
                </button>
                <span className="tech-chat__status" style={{ flex: 1 }}>
                  Short clip → server transcription (uses OPENAI_API_KEY).
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        <form
          className="tech-chat__form"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <input
            className="tech-chat__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              speechListening
                ? "Listening… speak now"
                : "Ask about a product, specs, compatibility, troubleshooting…"
            }
            disabled={busy}
          />
          <button
            type="button"
            onClick={toggleSpeechListening}
            disabled={busy || !speechSupported || openAiVoicePhase !== "idle"}
            className={`tech-chat__mic ${speechListening ? "micListening tech-chat__mic--live" : ""}`}
            aria-pressed={speechListening}
            aria-label={speechListening ? "Stop voice input" : "Speak your question"}
            title={
              !speechSupported
                ? "Voice input is not supported in this browser (try Chrome or Edge)."
                : speechListening
                  ? "Stop listening"
                  : "Use microphone — speak in English (Chrome/Edge need internet for speech), then tap Send"
            }
            style={{
              cursor: busy || !speechSupported || openAiVoicePhase !== "idle" ? "not-allowed" : "pointer",
              opacity: !speechSupported ? 0.45 : openAiVoicePhase !== "idle" ? 0.55 : 1,
            }}
          >
            <MicIcon active={speechListening} />
          </button>
          <button type="submit" className="tech-chat__send" disabled={busy || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

